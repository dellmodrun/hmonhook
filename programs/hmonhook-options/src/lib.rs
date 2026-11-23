use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::{clock::Clock, rent::Rent, Sysvar},
};
use solana_system_interface::instruction as system_instruction;

mod token_2022 {
    solana_program::declare_id!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
}

const SERIES_TAG: [u8; 8] = *b"HMONOPT1";
const POSITION_TAG: [u8; 8] = *b"HMONPOS1";
const STATUS_ACTIVE: u8 = 0;
const STATUS_DEFAULT: u8 = 1;
const STATUS_CLOSED: u8 = 2;

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct Series {
    pub tag: [u8; 8],
    pub status: u8,
    pub bump: u8,
    pub nonce: u64,
    pub issuer: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub treasury: Pubkey,
    pub treasury_floor: u64,
    pub supply_snapshot: u64,
    pub lot_size: u64,
    pub total_lots: u64,
    pub sold_lots: u64,
    pub exercised_lots: u64,
    pub default_claimed_lots: u64,
    pub reclaimed_lots: u64,
    pub sale_deadline_slot: u64,
    pub expiry_slot: u64,
    pub strike_lamports: u64,
    pub premium_lamports: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct Position {
    pub tag: [u8; 8],
    pub bump: u8,
    pub series: Pubkey,
    pub buyer: Pubkey,
    pub bought_lots: u64,
    pub exercised_lots: u64,
    pub default_claimed_lots: u64,
}

fn invalid() -> ProgramError { ProgramError::InvalidInstructionData }
fn bad_account() -> ProgramError { ProgramError::InvalidAccountData }
fn overflow() -> ProgramError { ProgramError::ArithmeticOverflow }

fn u64_at(data: &[u8], at: usize) -> Result<u64, ProgramError> {
    let end = at.checked_add(8).ok_or_else(invalid)?;
    let bytes: [u8; 8] = data.get(at..end).ok_or_else(invalid)?.try_into().map_err(|_| invalid())?;
    Ok(u64::from_le_bytes(bytes))
}

fn token_data(account: &AccountInfo, mint: &Pubkey, authority: &Pubkey) -> Result<u64, ProgramError> {
    if account.owner != &token_2022::id() { return Err(bad_account()); }
    let data = account.try_borrow_data()?;
    if data.len() < 165 || data.get(0..32) != Some(mint.as_ref()) || data.get(32..64) != Some(authority.as_ref()) || data[108] != 1 {
        return Err(bad_account());
    }
    u64_at(&data, 64)
}

fn treasury_breached(account: &AccountInfo, series: &Series) -> bool {
    // An emptied and closed registered treasury is also a breach. Requiring
    // a valid token account here would let the issuer evade the rule by closing it.
    match token_data(account, &series.mint, &series.issuer) {
        Ok(amount) => amount < series.treasury_floor,
        Err(_) => true,
    }
}

fn mint_data(mint: &AccountInfo) -> Result<(u64, u8), ProgramError> {
    if mint.owner != &token_2022::id() { return Err(bad_account()); }
    let data = mint.try_borrow_data()?;
    if data.len() < 82 || data.get(0..4) != Some(&[0, 0, 0, 0]) || data.get(46..50) != Some(&[0, 0, 0, 0]) || data[45] != 1 || !supported_mint_extensions(&data) {
        return Err(bad_account());
    }
    Ok((u64_at(&data, 36)?, data[44]))
}

fn supported_mint_extensions(data: &[u8]) -> bool {
    if data.len() == 82 { return true; }
    // Token-2022 pads extended Mints to 165 bytes, then writes the Mint
    // account-type byte and TLV entries. Only descriptive metadata/group
    // extensions are accepted. A permanent delegate, transfer hook, fee,
    // confidential transfer or pause authority can defeat collateral delivery.
    if data.len() < 166 || data[82..165].iter().any(|byte| *byte != 0) || data[165] != 1 { return false; }
    let mut offset = 166;
    while offset < data.len() {
        if data[offset..].iter().all(|byte| *byte == 0) { return true; }
        if data.len() - offset < 4 { return false; }
        let kind = u16::from_le_bytes([data[offset], data[offset + 1]]);
        let length = u16::from_le_bytes([data[offset + 2], data[offset + 3]]) as usize;
        if !(18..=23).contains(&kind) || length == 0 { return false; }
        offset = match offset.checked_add(4).and_then(|n| n.checked_add(length)) {
            Some(end) if end <= data.len() => end,
            _ => return false,
        };
    }
    true
}

fn load_series(program_id: &Pubkey, account: &AccountInfo) -> Result<Series, ProgramError> {
    if account.owner != program_id { return Err(bad_account()); }
    let series = Series::try_from_slice(&account.try_borrow_data()?).map_err(|_| bad_account())?;
    let (expected, bump) = Pubkey::find_program_address(&[b"series", series.mint.as_ref(), series.issuer.as_ref(), &series.nonce.to_le_bytes()], program_id);
    if series.tag != SERIES_TAG || expected != *account.key || bump != series.bump {
        return Err(bad_account());
    }
    Ok(series)
}

fn save<T: BorshSerialize>(account: &AccountInfo, value: &T) -> ProgramResult {
    value.serialize(&mut &mut account.try_borrow_mut_data()?[..]).map_err(|_| bad_account())
}

fn transfer_tokens<'a>(source: &AccountInfo<'a>, destination: &AccountInfo<'a>, mint: &AccountInfo<'a>, authority: &AccountInfo<'a>, token_program: &AccountInfo<'a>, amount: u64, decimals: u8, seeds: Option<&[&[u8]]>) -> ProgramResult {
    if token_program.key != &token_2022::id() { return Err(bad_account()); }
    let mut data = vec![12];
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(decimals);
    let instruction = Instruction { program_id: token_2022::id(), accounts: vec![
        AccountMeta::new(*source.key, false), AccountMeta::new_readonly(*mint.key, false),
        AccountMeta::new(*destination.key, false), AccountMeta::new_readonly(*authority.key, true),
    ], data };
    let infos = [source.clone(), mint.clone(), destination.clone(), authority.clone(), token_program.clone()];
    match seeds {
        Some(seeds) => invoke_signed(&instruction, &infos, &[seeds]),
        None => invoke(&instruction, &infos),
    }
}

fn create_pda<'a>(payer: &AccountInfo<'a>, target: &AccountInfo<'a>, system: &AccountInfo<'a>, program_id: &Pubkey, space: usize, seeds: &[&[u8]]) -> ProgramResult {
    if system.key != &solana_system_interface::program::id() || !payer.is_signer || !target.is_writable { return Err(bad_account()); }
    let lamports = Rent::get()?.minimum_balance(space);
    let ix = system_instruction::create_account(payer.key, target.key, lamports, space as u64, program_id);
    invoke_signed(&ix, &[payer.clone(), target.clone(), system.clone()], &[seeds])
}

fn transfer_sol<'a>(payer: &AccountInfo<'a>, recipient: &AccountInfo<'a>, system: &AccountInfo<'a>, amount: u64) -> ProgramResult {
    if system.key != &solana_system_interface::program::id() || !payer.is_signer { return Err(bad_account()); }
    let ix = system_instruction::transfer(payer.key, recipient.key, amount);
    invoke(&ix, &[payer.clone(), recipient.clone(), system.clone()])
}

fn position_remaining(position: &Position) -> Result<u64, ProgramError> {
    position.bought_lots.checked_sub(position.exercised_lots).and_then(|v| v.checked_sub(position.default_claimed_lots)).ok_or_else(overflow)
}

fn initialize(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != 48 { return Err(invalid()); }
    let nonce = u64_at(data, 0)?;
    let deposit = u64_at(data, 8)?;
    let strike = u64_at(data, 16)?;
    let sale_deadline = u64_at(data, 24)?;
    let expiry = u64_at(data, 32)?;
    let floor = u64_at(data, 40)?;
    let mut it = accounts.iter();
    let issuer = next_account_info(&mut it)?;
    let mint = next_account_info(&mut it)?;
    let source = next_account_info(&mut it)?;
    let vault = next_account_info(&mut it)?;
    let treasury = next_account_info(&mut it)?;
    let state = next_account_info(&mut it)?;
    let token_program = next_account_info(&mut it)?;
    let system = next_account_info(&mut it)?;
    if !issuer.is_signer || !issuer.is_writable || !source.is_writable || !vault.is_writable || !state.is_writable { return Err(bad_account()); }
    let slot = Clock::get()?.slot;
    if sale_deadline <= slot || expiry <= sale_deadline || strike == 0 { return Err(invalid()); }
    let (supply, decimals) = mint_data(mint)?;
    let lot_size = 10_u64.checked_pow(decimals as u32).ok_or_else(overflow)?;
    if supply == 0 || deposit == 0 || deposit % lot_size != 0 || (deposit as u128) * 100 < (supply as u128) * 2 || (deposit as u128) * 100 > (supply as u128) * 10 { return Err(invalid()); }
    token_data(source, mint.key, issuer.key)?;
    token_data(vault, mint.key, state.key)?;
    let treasury_amount = token_data(treasury, mint.key, issuer.key)?;
    if floor == 0 || floor > treasury_amount || treasury.key == source.key { return Err(invalid()); }
    let (expected, bump) = Pubkey::find_program_address(&[b"series", mint.key.as_ref(), issuer.key.as_ref(), &nonce.to_le_bytes()], program_id);
    if expected != *state.key { return Err(bad_account()); }
    let premium = strike / 10 + u64::from(strike % 10 != 0);
    let series = Series { tag: SERIES_TAG, status: STATUS_ACTIVE, bump, nonce, issuer: *issuer.key, mint: *mint.key, vault: *vault.key, treasury: *treasury.key, treasury_floor: floor, supply_snapshot: supply, lot_size, total_lots: deposit / lot_size, sold_lots: 0, exercised_lots: 0, default_claimed_lots: 0, reclaimed_lots: 0, sale_deadline_slot: sale_deadline, expiry_slot: expiry, strike_lamports: strike, premium_lamports: premium };
    let size = borsh::to_vec(&series).map_err(|_| invalid())?.len();
    let seeds = [b"series".as_ref(), mint.key.as_ref(), issuer.key.as_ref(), &nonce.to_le_bytes(), &[bump]];
    create_pda(issuer, state, system, program_id, size, &seeds)?;
    let before = token_data(vault, mint.key, state.key)?;
    transfer_tokens(source, vault, mint, issuer, token_program, deposit, decimals, None)?;
    let received = token_data(vault, mint.key, state.key)?.checked_sub(before).ok_or_else(overflow)?;
    if received != deposit { return Err(bad_account()); }
    save(state, &series)
}

fn buy(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != 8 { return Err(invalid()); }
    let lots = u64_at(data, 0)?;
    if lots == 0 { return Err(invalid()); }
    let mut it = accounts.iter();
    let buyer = next_account_info(&mut it)?;
    let state = next_account_info(&mut it)?;
    let position_account = next_account_info(&mut it)?;
    let system = next_account_info(&mut it)?;
    if !buyer.is_signer || !buyer.is_writable || !state.is_writable || !position_account.is_writable { return Err(bad_account()); }
    let mut series = load_series(program_id, state)?;
    if series.status != STATUS_ACTIVE || Clock::get()?.slot > series.sale_deadline_slot { return Err(invalid()); }
    let sold = series.sold_lots.checked_add(lots).ok_or_else(overflow)?;
    if sold > series.total_lots { return Err(invalid()); }
    let (expected, bump) = Pubkey::find_program_address(&[b"position", state.key.as_ref(), buyer.key.as_ref()], program_id);
    if expected != *position_account.key { return Err(bad_account()); }
    let mut position = if position_account.owner == program_id {
        Position::try_from_slice(&position_account.try_borrow_data()?).map_err(|_| bad_account())?
    } else {
        let value = Position { tag: POSITION_TAG, bump, series: *state.key, buyer: *buyer.key, bought_lots: 0, exercised_lots: 0, default_claimed_lots: 0 };
        let size = borsh::to_vec(&value).map_err(|_| invalid())?.len();
        let seeds = [b"position".as_ref(), state.key.as_ref(), buyer.key.as_ref(), &[bump]];
        create_pda(buyer, position_account, system, program_id, size, &seeds)?;
        value
    };
    if position.tag != POSITION_TAG || position.series != *state.key || position.buyer != *buyer.key || position.bump != bump { return Err(bad_account()); }
    let premium = lots.checked_mul(series.premium_lamports).ok_or_else(overflow)?;
    transfer_sol(buyer, state, system, premium)?;
    position.bought_lots = position.bought_lots.checked_add(lots).ok_or_else(overflow)?;
    series.sold_lots = sold;
    save(position_account, &position)?;
    save(state, &series)
}

fn load_position(program_id: &Pubkey, account: &AccountInfo, state: &AccountInfo, buyer: &AccountInfo) -> Result<Position, ProgramError> {
    if account.owner != program_id { return Err(bad_account()); }
    let position = Position::try_from_slice(&account.try_borrow_data()?).map_err(|_| bad_account())?;
    let expected = Pubkey::create_program_address(&[b"position", state.key.as_ref(), buyer.key.as_ref(), &[position.bump]], program_id).map_err(|_| bad_account())?;
    if expected != *account.key || position.tag != POSITION_TAG || position.series != *state.key || position.buyer != *buyer.key { return Err(bad_account()); }
    Ok(position)
}

fn settle(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8], default_claim: bool) -> ProgramResult {
    if data.len() != 8 { return Err(invalid()); }
    let lots = u64_at(data, 0)?;
    if lots == 0 { return Err(invalid()); }
    let mut it = accounts.iter();
    let buyer = next_account_info(&mut it)?;
    let issuer = next_account_info(&mut it)?;
    let state = next_account_info(&mut it)?;
    let position_account = next_account_info(&mut it)?;
    let mint = next_account_info(&mut it)?;
    let vault = next_account_info(&mut it)?;
    let destination = next_account_info(&mut it)?;
    let token_program = next_account_info(&mut it)?;
    let system = next_account_info(&mut it)?;
    if !buyer.is_signer || !buyer.is_writable || !issuer.is_writable || !state.is_writable || !position_account.is_writable || !vault.is_writable || !destination.is_writable { return Err(bad_account()); }
    let mut series = load_series(program_id, state)?;
    if *issuer.key != series.issuer || *mint.key != series.mint || *vault.key != series.vault || (!default_claim && Clock::get()?.slot > series.expiry_slot) { return Err(bad_account()); }
    if (default_claim && series.status != STATUS_DEFAULT) || (!default_claim && series.status != STATUS_ACTIVE) { return Err(invalid()); }
    let mut position = load_position(program_id, position_account, state, buyer)?;
    if lots > position_remaining(&position)? { return Err(invalid()); }
    token_data(vault, mint.key, state.key)?;
    let before = token_data(destination, mint.key, buyer.key)?;
    let (_, decimals) = mint_data(mint)?;
    let tokens = lots.checked_mul(series.lot_size).ok_or_else(overflow)?;
    if !default_claim {
        let strike = lots.checked_mul(series.strike_lamports).ok_or_else(overflow)?;
        transfer_sol(buyer, issuer, system, strike)?;
        position.exercised_lots = position.exercised_lots.checked_add(lots).ok_or_else(overflow)?;
        series.exercised_lots = series.exercised_lots.checked_add(lots).ok_or_else(overflow)?;
    } else {
        position.default_claimed_lots = position.default_claimed_lots.checked_add(lots).ok_or_else(overflow)?;
        series.default_claimed_lots = series.default_claimed_lots.checked_add(lots).ok_or_else(overflow)?;
    }
    let nonce = series.nonce.to_le_bytes();
    let bump = [series.bump];
    let seeds = [b"series".as_ref(), series.mint.as_ref(), series.issuer.as_ref(), nonce.as_ref(), bump.as_ref()];
    transfer_tokens(vault, destination, mint, state, token_program, tokens, decimals, Some(&seeds))?;
    let received = token_data(destination, mint.key, buyer.key)?.checked_sub(before).ok_or_else(overflow)?;
    if received != tokens { return Err(bad_account()); }
    save(position_account, &position)?;
    save(state, &series)
}

fn trigger_default(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let mut it = accounts.iter();
    let state = next_account_info(&mut it)?;
    let treasury = next_account_info(&mut it)?;
    if !state.is_writable { return Err(bad_account()); }
    let mut series = load_series(program_id, state)?;
    if series.status != STATUS_ACTIVE || Clock::get()?.slot > series.expiry_slot || *treasury.key != series.treasury { return Err(invalid()); }
    if !treasury_breached(treasury, &series) { return Err(invalid()); }
    series.status = STATUS_DEFAULT;
    save(state, &series)
}

fn reclaim(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let mut it = accounts.iter();
    let issuer = next_account_info(&mut it)?;
    let state = next_account_info(&mut it)?;
    let mint = next_account_info(&mut it)?;
    let vault = next_account_info(&mut it)?;
    let destination = next_account_info(&mut it)?;
    let token_program = next_account_info(&mut it)?;
    if !issuer.is_signer || !state.is_writable || !vault.is_writable || !destination.is_writable { return Err(bad_account()); }
    let mut series = load_series(program_id, state)?;
    if *issuer.key != series.issuer || *mint.key != series.mint || *vault.key != series.vault || Clock::get()?.slot <= series.expiry_slot || series.status == STATUS_CLOSED { return Err(invalid()); }
    token_data(vault, mint.key, state.key)?;
    token_data(destination, mint.key, issuer.key)?;
    let (_, decimals) = mint_data(mint)?;
    let lots = if series.status == STATUS_DEFAULT {
        series.total_lots.checked_sub(series.sold_lots).and_then(|v| v.checked_sub(series.reclaimed_lots)).ok_or_else(overflow)?
    } else {
        series.total_lots.checked_sub(series.exercised_lots).and_then(|v| v.checked_sub(series.reclaimed_lots)).ok_or_else(overflow)?
    };
    if lots == 0 { return Err(invalid()); }
    let amount = lots.checked_mul(series.lot_size).ok_or_else(overflow)?;
    let nonce = series.nonce.to_le_bytes();
    let bump = [series.bump];
    let seeds = [b"series".as_ref(), series.mint.as_ref(), series.issuer.as_ref(), nonce.as_ref(), bump.as_ref()];
    transfer_tokens(vault, destination, mint, state, token_program, amount, decimals, Some(&seeds))?;
    series.reclaimed_lots = series.reclaimed_lots.checked_add(lots).ok_or_else(overflow)?;
    if series.status != STATUS_DEFAULT { series.status = STATUS_CLOSED; }
    save(state, &series)
}

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let (&op, payload) = data.split_first().ok_or_else(invalid)?;
    match op {
        0 => initialize(program_id, accounts, payload),
        1 => buy(program_id, accounts, payload),
        2 => settle(program_id, accounts, payload, false),
        3 if payload.is_empty() => trigger_default(program_id, accounts),
        4 => settle(program_id, accounts, payload, true),
        5 if payload.is_empty() => reclaim(program_id, accounts),
        _ => Err(invalid()),
    }
}

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn premium_rounds_up_and_minimum_deposit_is_enforced() {
        for strike in [1_u64, 9, 10, 11, 100] {
            let premium = strike / 10 + u64::from(strike % 10 != 0);
            assert_eq!(premium, (strike + 9) / 10);
        }
        let supply = 1_000_000_000_u64;
        assert!((20_000_000_u128) * 100 >= (supply as u128) * 2);
        assert!((100_000_000_u128) * 100 <= (supply as u128) * 10);
        assert!((19_999_999_u128) * 100 < (supply as u128) * 2);
    }

    #[test]
    fn positions_cannot_claim_the_same_lot_twice() {
        let position = Position { tag: POSITION_TAG, bump: 1, series: Pubkey::new_unique(), buyer: Pubkey::new_unique(), bought_lots: 5, exercised_lots: 2, default_claimed_lots: 1 };
        assert_eq!(position_remaining(&position).unwrap(), 2);
        let invalid = Position { default_claimed_lots: 4, ..position };
        assert!(position_remaining(&invalid).is_err());
    }

    #[test]
    fn closed_registered_treasury_counts_as_an_outflow() {
        let issuer = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let treasury = Pubkey::new_unique();
        let series = Series {
            tag: SERIES_TAG, status: STATUS_ACTIVE, bump: 0, nonce: 0,
            issuer, mint, vault: Pubkey::new_unique(), treasury,
            treasury_floor: 50, supply_snapshot: 1_000, lot_size: 1,
            total_lots: 20, sold_lots: 0, exercised_lots: 0,
            default_claimed_lots: 0, reclaimed_lots: 0,
            sale_deadline_slot: 10, expiry_slot: 20,
            strike_lamports: 100, premium_lamports: 10,
        };
        let mut lamports = 1;
        let mut data = [0u8; 165];
        data[..32].copy_from_slice(mint.as_ref());
        data[32..64].copy_from_slice(issuer.as_ref());
        data[64..72].copy_from_slice(&50_u64.to_le_bytes());
        data[108] = 1;
        let token_id = token_2022::id();
        let account = AccountInfo::new(&treasury, false, false, &mut lamports, &mut data, &token_id, false);
        assert!(!treasury_breached(&account, &series));
        account.try_borrow_mut_data().unwrap()[64..72].copy_from_slice(&49_u64.to_le_bytes());
        assert!(treasury_breached(&account, &series));
        drop(account);
        let mut closed_data = [];
        let system_id = solana_system_interface::program::id();
        let closed = AccountInfo::new(&treasury, false, false, &mut lamports, &mut closed_data, &system_id, false);
        assert!(treasury_breached(&closed, &series));
    }

    #[test]
    fn rejects_extensions_that_can_break_escrow_delivery() {
        assert!(supported_mint_extensions(&[0; 82]));
        let mut mint = vec![0_u8; 166 + 4 + 8];
        mint[165] = 1;
        mint[166..168].copy_from_slice(&18_u16.to_le_bytes());
        mint[168..170].copy_from_slice(&8_u16.to_le_bytes());
        assert!(supported_mint_extensions(&mint));
        for disallowed in [1_u16, 12, 14, 24, 27] {
            mint[166..168].copy_from_slice(&disallowed.to_le_bytes());
            assert!(!supported_mint_extensions(&mint));
        }
        mint[166..168].copy_from_slice(&18_u16.to_le_bytes());
        mint[168..170].copy_from_slice(&100_u16.to_le_bytes());
        assert!(!supported_mint_extensions(&mint));
    }
}
