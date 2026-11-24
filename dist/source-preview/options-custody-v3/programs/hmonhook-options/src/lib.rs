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
mod token_legacy {
    solana_program::declare_id!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
}
mod associated_token {
    solana_program::declare_id!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
}
mod wrapped_sol {
    solana_program::declare_id!("So11111111111111111111111111111111111111112");
}
mod pump_quote_sol {
    solana_program::declare_id!("9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP");
}
mod pump {
    solana_program::declare_id!("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
}
mod pump_swap {
    solana_program::declare_id!("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
}
mod pump_fees {
    solana_program::declare_id!("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
}
mod pump_fee_config {
    solana_program::declare_id!("8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt");
}

const SERIES_TAG: [u8; 8] = *b"HMONOPT3";
const POSITION_TAG: [u8; 8] = *b"HMONPOS3";
const STATUS_ACTIVE: u8 = 0;
const STATUS_DEFAULT: u8 = 1;
const STATUS_CLOSED: u8 = 2;
const PUMP_BUYBACK_FEE_RECIPIENTS: [&str; 8] = [
    "5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD",
    "9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7",
    "GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL",
    "3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR",
    "5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6",
    "EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL",
    "5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD",
    "A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW",
];

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
    pub premium_spent_lamports: u64,
    pub premium_refunded_lamports: u64,
    pub premium_refund_claimed_lots: u64,
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
    pub premium_refunded: u8,
}

fn invalid() -> ProgramError { ProgramError::InvalidInstructionData }
fn bad_account() -> ProgramError { ProgramError::InvalidAccountData }
fn overflow() -> ProgramError { ProgramError::ArithmeticOverflow }

fn u64_at(data: &[u8], at: usize) -> Result<u64, ProgramError> {
    let end = at.checked_add(8).ok_or_else(invalid)?;
    let bytes: [u8; 8] = data.get(at..end).ok_or_else(invalid)?.try_into().map_err(|_| invalid())?;
    Ok(u64::from_le_bytes(bytes))
}

// Pump's BondingCurve V2 layout: 8-byte discriminator, five u64 reserve/supply
// fields, complete flag, creator, two flags, then quote Mint. The same
// exact-token calculation is used by the browser to propose one-token terms.
fn pump_curve_strike(data: &[u8], lot_size: u64) -> Result<u64, ProgramError> {
    const DISCRIMINATOR: [u8; 8] = [23, 183, 248, 55, 96, 216, 172, 96];
    if data.len() < 115 || data.get(0..8) != Some(&DISCRIMINATOR) || data[48] != 0 || lot_size == 0 {
        return Err(bad_account());
    }
    let quote_mint = data.get(83..115).ok_or_else(bad_account)?;
    if quote_mint != solana_system_interface::program::id().as_ref()
        && quote_mint != wrapped_sol::id().as_ref()
        && quote_mint != pump_quote_sol::id().as_ref()
    {
        return Err(bad_account());
    }
    let virtual_tokens = u64_at(data, 8)?;
    let virtual_quote = u64_at(data, 16)?;
    let real_tokens = u64_at(data, 24)?;
    if virtual_tokens <= lot_size || virtual_quote == 0 || real_tokens < lot_size { return Err(invalid()); }
    let numerator = (lot_size as u128).checked_mul(virtual_quote as u128).ok_or_else(overflow)?;
    let strike = numerator.checked_div((virtual_tokens - lot_size) as u128).ok_or_else(overflow)?
        .checked_add(1).ok_or_else(overflow)?;
    u64::try_from(strike).map_err(|_| overflow())
}

fn token_data(account: &AccountInfo, mint: &Pubkey, authority: &Pubkey) -> Result<u64, ProgramError> {
    if account.owner != &token_2022::id() { return Err(bad_account()); }
    let data = account.try_borrow_data()?;
    if data.len() < 165 || data.get(0..32) != Some(mint.as_ref()) || data.get(32..64) != Some(authority.as_ref()) || data[108] != 1 {
        return Err(bad_account());
    }
    u64_at(&data, 64)
}

fn vault_token_data(account: &AccountInfo, mint: &Pubkey, authority: &Pubkey) -> Result<u64, ProgramError> {
    let amount = token_data(account, mint, authority)?;
    let data = account.try_borrow_data()?;
    // A preapproved delegate can transfer escrowed tokens without the series
    // PDA signing. The vault must have no delegate or delegated allowance.
    if data.get(72..76) != Some(&[0; 4]) || u64_at(&data, 121)? != 0 {
        return Err(bad_account());
    }
    Ok(amount)
}

fn legacy_vault_token_data(account: &AccountInfo, mint: &Pubkey, authority: &Pubkey) -> Result<u64, ProgramError> {
    if account.owner != &token_legacy::id() { return Err(bad_account()); }
    let data = account.try_borrow_data()?;
    if data.len() < 165 || data.get(0..32) != Some(mint.as_ref()) ||
        data.get(32..64) != Some(authority.as_ref()) || data[108] != 1 ||
        data.get(72..76) != Some(&[0; 4]) || u64_at(&data, 121)? != 0 {
        return Err(bad_account());
    }
    u64_at(&data, 64)
}

fn treasury_breached(account: &AccountInfo, series: &Series, authority: &Pubkey) -> bool {
    // Registered holdings are held under the Series PDA. No issuer-controlled
    // token transfer can lower this balance without a program instruction.
    match vault_token_data(account, &series.mint, authority) {
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

fn create_treasury<'a>(issuer: &AccountInfo<'a>, treasury: &AccountInfo<'a>, mint: &AccountInfo<'a>,
    state: &AccountInfo<'a>, token_program: &AccountInfo<'a>, system: &AccountInfo<'a>, seeds: &[&[u8]]) -> ProgramResult {
    if token_program.key != &token_2022::id() || system.key != &solana_system_interface::program::id() ||
        treasury.owner != system.key || treasury.data_len() != 0 || !treasury.is_writable { return Err(bad_account()); }
    let size = 165_usize;
    let lamports = Rent::get()?.minimum_balance(size);
    let create = system_instruction::create_account(issuer.key, treasury.key, lamports, size as u64, token_program.key);
    invoke_signed(&create, &[issuer.clone(), treasury.clone(), system.clone()], &[seeds])?;
    let mut data = vec![18]; // Token-2022 InitializeAccount3: authority follows the tag.
    data.extend_from_slice(state.key.as_ref());
    let initialize = Instruction { program_id: token_2022::id(), accounts: vec![
        AccountMeta::new(*treasury.key, false), AccountMeta::new_readonly(*mint.key, false),
    ], data };
    invoke(&initialize, &[treasury.clone(), mint.clone(), token_program.clone()])
}

fn transfer_sol<'a>(payer: &AccountInfo<'a>, recipient: &AccountInfo<'a>, system: &AccountInfo<'a>, amount: u64) -> ProgramResult {
    if system.key != &solana_system_interface::program::id() || !payer.is_signer { return Err(bad_account()); }
    let ix = system_instruction::transfer(payer.key, recipient.key, amount);
    invoke(&ix, &[payer.clone(), recipient.clone(), system.clone()])
}

fn ata(mint: &Pubkey, owner: &Pubkey, token_program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[owner.as_ref(), token_program.as_ref(), mint.as_ref()], &associated_token::id()).0
}

fn pump_buyback_fee_recipient(address: &Pubkey) -> bool {
    PUMP_BUYBACK_FEE_RECIPIENTS.iter().any(|value| value.parse::<Pubkey>().ok().as_ref() == Some(address))
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
    let buyback_user = next_account_info(&mut it)?;
    let token_program = next_account_info(&mut it)?;
    let system = next_account_info(&mut it)?;
    let curve = next_account_info(&mut it)?;
    if !issuer.is_signer || !issuer.is_writable || !source.is_writable || !vault.is_writable || !treasury.is_writable || !state.is_writable || !buyback_user.is_writable { return Err(bad_account()); }
    let slot = Clock::get()?.slot;
    if sale_deadline <= slot || expiry <= sale_deadline || strike == 0 { return Err(invalid()); }
    let (supply, decimals) = mint_data(mint)?;
    let lot_size = 10_u64.checked_pow(decimals as u32).ok_or_else(overflow)?;
    let expected_curve = Pubkey::find_program_address(&[b"bonding-curve", mint.key.as_ref()], &pump::id()).0;
    if *curve.key != expected_curve || curve.owner != &pump::id() ||
        pump_curve_strike(&curve.try_borrow_data()?, lot_size)? != strike {
        return Err(bad_account());
    }
    if supply == 0 || deposit == 0 || deposit % lot_size != 0 || (deposit as u128) * 100 < (supply as u128) * 2 || (deposit as u128) * 100 > (supply as u128) * 10 { return Err(invalid()); }
    if *source.key != ata(mint.key, issuer.key, &token_2022::id()) { return Err(bad_account()); }
    let source_amount = token_data(source, mint.key, issuer.key)?;
    if vault_token_data(vault, mint.key, state.key)? != 0 { return Err(bad_account()); }
    let expected_remaining = source_amount.checked_sub(deposit).ok_or_else(invalid)?;
    if floor == 0 || floor > expected_remaining { return Err(invalid()); }
    let (expected, bump) = Pubkey::find_program_address(&[b"series", mint.key.as_ref(), issuer.key.as_ref(), &nonce.to_le_bytes()], program_id);
    if expected != *state.key { return Err(bad_account()); }
    let (expected_treasury, treasury_bump) = Pubkey::find_program_address(&[b"treasury", state.key.as_ref()], program_id);
    if expected_treasury != *treasury.key { return Err(bad_account()); }
    let expected_buyback = Pubkey::find_program_address(&[b"buyback", state.key.as_ref()], program_id).0;
    if expected_buyback != *buyback_user.key || buyback_user.owner != &solana_system_interface::program::id() || buyback_user.data_len() != 0 { return Err(bad_account()); }
    let premium = strike / 10 + u64::from(strike % 10 != 0);
    let series = Series { tag: SERIES_TAG, status: STATUS_ACTIVE, bump, nonce, issuer: *issuer.key, mint: *mint.key, vault: *vault.key, treasury: *treasury.key, treasury_floor: floor, supply_snapshot: supply, lot_size, total_lots: deposit / lot_size, sold_lots: 0, exercised_lots: 0, default_claimed_lots: 0, reclaimed_lots: 0, sale_deadline_slot: sale_deadline, expiry_slot: expiry, strike_lamports: strike, premium_lamports: premium, premium_spent_lamports: 0, premium_refunded_lamports: 0, premium_refund_claimed_lots: 0 };
    let size = borsh::to_vec(&series).map_err(|_| invalid())?.len();
    let seeds = [b"series".as_ref(), mint.key.as_ref(), issuer.key.as_ref(), &nonce.to_le_bytes(), &[bump]];
    create_pda(issuer, state, system, program_id, size, &seeds)?;
    let treasury_bump_seed = [treasury_bump];
    let treasury_seeds = [b"treasury".as_ref(), state.key.as_ref(), treasury_bump_seed.as_ref()];
    create_treasury(issuer, treasury, mint, state, token_program, system, &treasury_seeds)?;
    let rent_reserve = Rent::get()?.minimum_balance(0);
    let rent_topup = rent_reserve.saturating_sub(buyback_user.lamports());
    if rent_topup != 0 { transfer_sol(issuer, buyback_user, system, rent_topup)?; }
    let before = vault_token_data(vault, mint.key, state.key)?;
    transfer_tokens(source, vault, mint, issuer, token_program, deposit, decimals, None)?;
    let received = vault_token_data(vault, mint.key, state.key)?.checked_sub(before).ok_or_else(overflow)?;
    if received != deposit { return Err(bad_account()); }
    transfer_tokens(source, treasury, mint, issuer, token_program, floor, decimals, None)?;
    if token_data(source, mint.key, issuer.key)? != expected_remaining - floor ||
        vault_token_data(treasury, mint.key, state.key)? != floor { return Err(bad_account()); }
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
    let treasury = next_account_info(&mut it)?;
    let buyback_user = next_account_info(&mut it)?;
    let system = next_account_info(&mut it)?;
    if !buyer.is_signer || !buyer.is_writable || !state.is_writable || !position_account.is_writable || !buyback_user.is_writable { return Err(bad_account()); }
    let mut series = load_series(program_id, state)?;
    let expected_buyback = Pubkey::find_program_address(&[b"buyback", state.key.as_ref()], program_id).0;
    if *buyback_user.key != expected_buyback || buyback_user.owner != &solana_system_interface::program::id() || buyback_user.data_len() != 0 { return Err(bad_account()); }
    if series.status != STATUS_ACTIVE || Clock::get()?.slot > series.sale_deadline_slot { return Err(invalid()); }
    if *treasury.key != series.treasury || treasury_breached(treasury, &series, state.key) { return Err(invalid()); }
    let sold = series.sold_lots.checked_add(lots).ok_or_else(overflow)?;
    if sold > series.total_lots { return Err(invalid()); }
    let (expected, bump) = Pubkey::find_program_address(&[b"position", state.key.as_ref(), buyer.key.as_ref()], program_id);
    if expected != *position_account.key { return Err(bad_account()); }
    let mut position = if position_account.owner == program_id {
        Position::try_from_slice(&position_account.try_borrow_data()?).map_err(|_| bad_account())?
    } else {
        let value = Position { tag: POSITION_TAG, bump, series: *state.key, buyer: *buyer.key, bought_lots: 0, exercised_lots: 0, default_claimed_lots: 0, premium_refunded: 0 };
        let size = borsh::to_vec(&value).map_err(|_| invalid())?.len();
        let seeds = [b"position".as_ref(), state.key.as_ref(), buyer.key.as_ref(), &[bump]];
        create_pda(buyer, position_account, system, program_id, size, &seeds)?;
        value
    };
    if position.tag != POSITION_TAG || position.series != *state.key || position.buyer != *buyer.key || position.bump != bump || position.premium_refunded != 0 { return Err(bad_account()); }
    let premium = lots.checked_mul(series.premium_lamports).ok_or_else(overflow)?;
    transfer_sol(buyer, buyback_user, system, premium)?;
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
    vault_token_data(vault, mint.key, state.key)?;
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
    if !treasury_breached(treasury, &series, state.key) { return Err(invalid()); }
    series.status = STATUS_DEFAULT;
    save(state, &series)
}

// Releasing the registered allocation before expiry irrevocably defaults the
// option series. The issuer cannot move tokens from this PDA by any other path.
fn withdraw_registered_treasury(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    if accounts.len() != 6 { return Err(invalid()); }
    let issuer = &accounts[0];
    let state = &accounts[1];
    let mint = &accounts[2];
    let treasury = &accounts[3];
    let destination = &accounts[4];
    let token_program = &accounts[5];
    if !issuer.is_signer || !state.is_writable || !treasury.is_writable || !destination.is_writable {
        return Err(bad_account());
    }
    let mut series = load_series(program_id, state)?;
    if *issuer.key != series.issuer || *mint.key != series.mint || *treasury.key != series.treasury {
        return Err(bad_account());
    }
    token_data(destination, mint.key, issuer.key)?;
    let amount = vault_token_data(treasury, mint.key, state.key)?;
    if amount == 0 { return Err(invalid()); }
    let (_, decimals) = mint_data(mint)?;
    let nonce = series.nonce.to_le_bytes();
    let bump = [series.bump];
    let seeds = [b"series".as_ref(), mint.key.as_ref(), issuer.key.as_ref(), nonce.as_ref(), bump.as_ref()];
    if Clock::get()?.slot <= series.expiry_slot && series.status == STATUS_ACTIVE {
        series.status = STATUS_DEFAULT;
    }
    transfer_tokens(treasury, destination, mint, state, token_program, amount, decimals, Some(&seeds))?;
    if vault_token_data(treasury, mint.key, state.key)? != 0 { return Err(bad_account()); }
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
    let slot = Clock::get()?.slot;
    if *issuer.key != series.issuer || *mint.key != series.mint || *vault.key != series.vault || slot <= series.sale_deadline_slot || series.status == STATUS_CLOSED { return Err(invalid()); }
    vault_token_data(vault, mint.key, state.key)?;
    token_data(destination, mint.key, issuer.key)?;
    let (_, decimals) = mint_data(mint)?;
    let expired = slot > series.expiry_slot;
    let lots = if series.status == STATUS_DEFAULT || !expired {
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
    if expired && series.status != STATUS_DEFAULT { series.status = STATUS_CLOSED; }
    save(state, &series)
}

fn refund_entitlement(series: &Series, position: &Position) -> Result<(u64, u64), ProgramError> {
    if series.sold_lots == 0 || position.bought_lots == 0 || position.premium_refunded != 0 {
        return Err(invalid());
    }
    let claimed_lots = series.premium_refund_claimed_lots.checked_add(position.bought_lots).ok_or_else(overflow)?;
    if claimed_lots > series.sold_lots { return Err(invalid()); }
    let total = series.sold_lots.checked_mul(series.premium_lamports).ok_or_else(overflow)?;
    let remaining = total.checked_sub(series.premium_spent_lamports).ok_or_else(overflow)?;
    let unrefunded = remaining.checked_sub(series.premium_refunded_lamports).ok_or_else(overflow)?;
    let amount = if claimed_lots == series.sold_lots {
        unrefunded
    } else {
        u64::try_from((remaining as u128) * (position.bought_lots as u128) / (series.sold_lots as u128)).map_err(|_| overflow())?
    };
    if amount > unrefunded { return Err(invalid()); }
    Ok((amount, claimed_lots))
}

fn claim_premium_refund(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let mut it = accounts.iter();
    let buyer = next_account_info(&mut it)?;
    let state = next_account_info(&mut it)?;
    let position_account = next_account_info(&mut it)?;
    let buyback_user = next_account_info(&mut it)?;
    let system = next_account_info(&mut it)?;
    if !buyer.is_signer || !buyer.is_writable || !state.is_writable || !position_account.is_writable || !buyback_user.is_writable ||
        system.key != &solana_system_interface::program::id() {
        return Err(bad_account());
    }
    let mut series = load_series(program_id, state)?;
    let (expected_buyback, bump) = Pubkey::find_program_address(&[b"buyback", state.key.as_ref()], program_id);
    if *buyback_user.key != expected_buyback || buyback_user.owner != &solana_system_interface::program::id() || buyback_user.data_len() != 0 { return Err(bad_account()); }
    if Clock::get()?.slot <= series.expiry_slot { return Err(invalid()); }
    let mut position = load_position(program_id, position_account, state, buyer)?;
    let (amount, claimed_lots) = refund_entitlement(&series, &position)?;
    let total = series.sold_lots.checked_mul(series.premium_lamports).ok_or_else(overflow)?;
    let unspent = total.checked_sub(series.premium_spent_lamports).ok_or_else(overflow)?;
    let due = unspent.checked_sub(series.premium_refunded_lamports).ok_or_else(overflow)?;
    if buyback_user.lamports() < Rent::get()?.minimum_balance(0).checked_add(due).ok_or_else(overflow)? { return Err(bad_account()); }
    series.premium_refund_claimed_lots = claimed_lots;
    series.premium_refunded_lamports = series.premium_refunded_lamports.checked_add(amount).ok_or_else(overflow)?;
    position.premium_refunded = 1;
    save(position_account, &position)?;
    save(state, &series)?;
    // A pro-rata share can round down to zero. It still has to be marked as
    // claimed so that the final claimant can collect the rounding remainder.
    if amount == 0 { return Ok(()); }
    let bump_seed = [bump];
    let seeds = [b"buyback".as_ref(), state.key.as_ref(), bump_seed.as_ref()];
    let ix = system_instruction::transfer(buyback_user.key, buyer.key, amount);
    invoke_signed(&ix, &[buyback_user.clone(), buyer.clone(), system.clone()], &[&seeds])
}

// The buyback PDA holds premiums paid in earlier purchase transactions. A
// keeper pays Pump's incidental account rent from its own SOL. A successful
// trade sends base
// tokens to a PDA vault for which this program has no withdrawal instruction.
fn buyback_on_pump(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != 24 || accounts.len() != 19 { return Err(invalid()); }
    let spend = u64_at(data, 0)?;
    let min_out = u64_at(data, 8)?;
    let keeper_topup = u64_at(data, 16)?;
    if spend == 0 || min_out == 0 || keeper_topup > 20_000_000 { return Err(invalid()); }
    let keeper = &accounts[0];
    let state = &accounts[1];
    let route = &accounts[2..19];
    if !keeper.is_signer || !keeper.is_writable || !state.is_writable { return Err(bad_account()); }
    let mut series = load_series(program_id, state)?;
    if series.status != STATUS_ACTIVE || series.sold_lots != series.total_lots ||
        Clock::get()?.slot >= series.expiry_slot { return Err(invalid()); }
    let received_premiums = series.sold_lots.checked_mul(series.premium_lamports).ok_or_else(overflow)?;
    let available = received_premiums.checked_sub(series.premium_spent_lamports)
        .and_then(|v| v.checked_sub(series.premium_refunded_lamports)).ok_or_else(overflow)?;
    if spend > available { return Err(invalid()); }
    // The keeper may demand a stricter output, but never a trade worse than
    // two times the series' published strike price, inclusive of Pump fees.
    let ceiling = (series.strike_lamports as u128).checked_mul(2).ok_or_else(overflow)?;
    let floor = ((spend as u128).checked_mul(series.lot_size as u128).ok_or_else(overflow)?
        + ceiling - 1) / ceiling;
    if (min_out as u128) < floor.max(1) { return Err(invalid()); }

    let (buyback_user, bump) = Pubkey::find_program_address(&[b"buyback", state.key.as_ref()], program_id);
    let curve = Pubkey::find_program_address(&[b"bonding-curve", series.mint.as_ref()], &pump::id()).0;
    let expected = [
        Pubkey::find_program_address(&[b"global"], &pump::id()).0,
        series.mint, wrapped_sol::id(), token_2022::id(), token_legacy::id(), curve,
        ata(&series.mint, &curve, &token_2022::id()),
        ata(&wrapped_sol::id(), &curve, &token_legacy::id()),
        buyback_user,
        ata(&series.mint, &buyback_user, &token_2022::id()),
        ata(&wrapped_sol::id(), &buyback_user, &token_legacy::id()),
        Pubkey::find_program_address(&[b"user_volume_accumulator", buyback_user.as_ref()], &pump::id()).0,
        pump_fee_config::id(),
        *route[13].key,
        solana_system_interface::program::id(),
        Pubkey::find_program_address(&[b"__event_authority"], &pump::id()).0,
        pump::id(),
    ];
    if route.iter().zip(expected.iter()).any(|(account, key)| account.key != key) ||
        !pump_buyback_fee_recipient(route[13].key) ||
        route[8].owner != &solana_system_interface::program::id() || route[8].data_len() != 0 {
        return Err(bad_account());
    }
    let before_tokens = vault_token_data(&route[9], &series.mint, &buyback_user)?;
    let minimum = Rent::get()?.minimum_balance(state.data_len());
    let state_before = state.lamports();
    if state_before < minimum { return Err(bad_account()); }
    let buyback_before = route[8].lamports();
    if buyback_before < Rent::get()?.minimum_balance(0).checked_add(available).ok_or_else(overflow)? { return Err(bad_account()); }
    if keeper_topup != 0 { transfer_sol(keeper, &route[8], &route[14], keeper_topup)?; }
    let funded = route[8].lamports();
    if funded != buyback_before.checked_add(keeper_topup).ok_or_else(overflow)? { return Err(bad_account()); }

    let mut cpi_data = vec![0xe1, 0xf7, 0x50, 0x1e, 0xd5, 0xb3, 0x84, 0x88];
    cpi_data.extend_from_slice(&spend.to_le_bytes());
    cpi_data.extend_from_slice(&min_out.to_le_bytes());
    cpi_data.push(0); // partial_fill = false
    let writable = [5_usize, 6, 7, 8, 9, 10, 11, 13];
    let metas = route.iter().enumerate().map(|(index, account)| {
        if writable.contains(&index) { AccountMeta::new(*account.key, index == 8) }
        else { AccountMeta::new_readonly(*account.key, false) }
    }).collect();
    let cpi = Instruction { program_id: pump::id(), accounts: metas, data: cpi_data };
    let bump_seed = [bump];
    let seeds = [b"buyback".as_ref(), state.key.as_ref(), bump_seed.as_ref()];
    invoke_signed(&cpi, route, &[&seeds])?;

    let tokens_out = vault_token_data(&route[9], &series.mint, &buyback_user)?
        .checked_sub(before_tokens).ok_or_else(overflow)?;
    if tokens_out < min_out || state.lamports() != state_before { return Err(bad_account()); }
    let buyback_after = route[8].lamports();
    let preserved = buyback_before.checked_sub(spend).ok_or_else(overflow)?;
    let refund_keeper = buyback_after.checked_sub(preserved).ok_or_else(overflow)?;
    if refund_keeper > keeper_topup { return Err(bad_account()); }
    if refund_keeper != 0 {
        let ix = system_instruction::transfer(route[8].key, keeper.key, refund_keeper);
        invoke_signed(&ix, &[route[8].clone(), keeper.clone(), route[14].clone()], &[&seeds])?;
    }
    if route[8].lamports() != preserved ||
        route[8].lamports() < Rent::get()?.minimum_balance(0).checked_add(available - spend).ok_or_else(overflow)? ||
        state.lamports() < minimum {
        return Err(bad_account());
    }
    series.premium_spent_lamports = series.premium_spent_lamports.checked_add(spend).ok_or_else(overflow)?;
    save(state, &series)
}

// A migrated Pump coin trades in its canonical SOL-quoted PumpSwap pool.
// Premiums are wrapped only inside this instruction. The PDA's wSOL ATA must
// return to its starting balance; bought tokens remain in the separate vault.
fn buyback_on_pump_swap(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != 24 || accounts.len() != 19 { return Err(invalid()); }
    let spend = u64_at(data, 0)?;
    let min_out = u64_at(data, 8)?;
    let keeper_topup = u64_at(data, 16)?;
    if spend == 0 || min_out == 0 || keeper_topup > 20_000_000 { return Err(invalid()); }
    let keeper = &accounts[0];
    let state = &accounts[1];
    let route = &accounts[2..19];
    if !keeper.is_signer || !keeper.is_writable || !state.is_writable { return Err(bad_account()); }
    let mut series = load_series(program_id, state)?;
    if series.status != STATUS_ACTIVE || series.sold_lots != series.total_lots ||
        Clock::get()?.slot >= series.expiry_slot { return Err(invalid()); }
    let received = series.sold_lots.checked_mul(series.premium_lamports).ok_or_else(overflow)?;
    let available = received.checked_sub(series.premium_spent_lamports)
        .and_then(|v| v.checked_sub(series.premium_refunded_lamports)).ok_or_else(overflow)?;
    if spend > available { return Err(invalid()); }
    let ceiling = (series.strike_lamports as u128).checked_mul(2).ok_or_else(overflow)?;
    let floor = ((spend as u128).checked_mul(series.lot_size as u128).ok_or_else(overflow)?
        + ceiling - 1) / ceiling;
    if (min_out as u128) < floor.max(1) { return Err(invalid()); }

    let (buyer, bump) = Pubkey::find_program_address(&[b"buyback", state.key.as_ref()], program_id);
    let pool_authority = Pubkey::find_program_address(&[b"pool-authority", series.mint.as_ref()], &pump::id()).0;
    let pool = Pubkey::find_program_address(&[
        b"pool", &0_u16.to_le_bytes(), pool_authority.as_ref(), series.mint.as_ref(), wrapped_sol::id().as_ref(),
    ], &pump_swap::id()).0;
    let expected = [
        pool, buyer,
        Pubkey::find_program_address(&[b"global_config"], &pump_swap::id()).0,
        series.mint, wrapped_sol::id(),
        ata(&series.mint, &buyer, &token_2022::id()),
        ata(&wrapped_sol::id(), &buyer, &token_legacy::id()),
        *route[7].key, *route[8].key,
        token_2022::id(), token_legacy::id(), solana_system_interface::program::id(),
        Pubkey::find_program_address(&[b"user_volume_accumulator", buyer.as_ref()], &pump_swap::id()).0,
        Pubkey::find_program_address(&[b"fee_config", pump_swap::id().as_ref()], &pump_fees::id()).0,
        *route[14].key,
        Pubkey::find_program_address(&[b"__event_authority"], &pump_swap::id()).0,
        pump_swap::id(),
    ];
    if route.iter().zip(expected.iter()).any(|(account, key)| account.key != key) ||
        !PUMP_BUYBACK_FEE_RECIPIENTS.iter().any(|recipient| {
            recipient.parse::<Pubkey>().ok().map(|address| ata(&wrapped_sol::id(), &address, &token_legacy::id())) == Some(*route[14].key)
        }) || route[1].owner != &solana_system_interface::program::id() || route[1].data_len() != 0 {
        return Err(bad_account());
    }
    if route[0].owner != &pump_swap::id() { return Err(bad_account()); }
    let pool_data = route[0].try_borrow_data()?;
    if pool_data.len() < 203 || pool_data.get(0..8) != Some(&[241, 154, 109, 4, 17, 177, 109, 188]) ||
        pool_data.get(9..11) != Some(&[0, 0]) ||
        pool_data.get(11..43) != Some(pool_authority.as_ref()) ||
        pool_data.get(43..75) != Some(series.mint.as_ref()) ||
        pool_data.get(75..107) != Some(wrapped_sol::id().as_ref()) ||
        pool_data.get(139..171) != Some(route[7].key.as_ref()) ||
        pool_data.get(171..203) != Some(route[8].key.as_ref()) { return Err(bad_account()); }
    drop(pool_data);
    let base_before = vault_token_data(&route[5], &series.mint, &buyer)?;
    let quote_before = legacy_vault_token_data(&route[6], &wrapped_sol::id(), &buyer)?;
    let minimum = Rent::get()?.minimum_balance(state.data_len());
    let state_before = state.lamports();
    let buyer_before = route[1].lamports();
    if state_before < minimum || buyer_before < Rent::get()?.minimum_balance(0).checked_add(available).ok_or_else(overflow)? {
        return Err(bad_account());
    }
    if keeper_topup != 0 { transfer_sol(keeper, &route[1], &route[11], keeper_topup)?; }
    let bump_seed = [bump];
    let seeds = [b"buyback".as_ref(), state.key.as_ref(), bump_seed.as_ref()];
    let wrap = system_instruction::transfer(route[1].key, route[6].key, spend);
    invoke_signed(&wrap, &[route[1].clone(), route[6].clone(), route[11].clone()], &[&seeds])?;
    let sync = Instruction { program_id: token_legacy::id(), accounts: vec![AccountMeta::new(*route[6].key, false)], data: vec![17] };
    invoke(&sync, &[route[6].clone(), route[10].clone()])?;
    if legacy_vault_token_data(&route[6], &wrapped_sol::id(), &buyer)? != quote_before.checked_add(spend).ok_or_else(overflow)? {
        return Err(bad_account());
    }

    let mut trade_data = vec![0xc2, 0xab, 0x1c, 0x46, 0x68, 0x4d, 0x5b, 0x2f];
    trade_data.extend_from_slice(&spend.to_le_bytes());
    trade_data.extend_from_slice(&min_out.to_le_bytes());
    let writable = [0_usize, 1, 5, 6, 7, 8, 12, 14];
    let metas = route.iter().enumerate().map(|(index, account)| {
        if writable.contains(&index) { AccountMeta::new(*account.key, index == 1) }
        else { AccountMeta::new_readonly(*account.key, false) }
    }).collect();
    let trade = Instruction { program_id: pump_swap::id(), accounts: metas, data: trade_data };
    invoke_signed(&trade, route, &[&seeds])?;
    let base_out = vault_token_data(&route[5], &series.mint, &buyer)?.checked_sub(base_before).ok_or_else(overflow)?;
    if base_out < min_out || legacy_vault_token_data(&route[6], &wrapped_sol::id(), &buyer)? != quote_before ||
        state.lamports() != state_before { return Err(bad_account()); }
    let preserved = buyer_before.checked_sub(spend).ok_or_else(overflow)?;
    let refund_keeper = route[1].lamports().checked_sub(preserved).ok_or_else(overflow)?;
    if refund_keeper > keeper_topup { return Err(bad_account()); }
    if refund_keeper != 0 {
        let refund = system_instruction::transfer(route[1].key, keeper.key, refund_keeper);
        invoke_signed(&refund, &[route[1].clone(), keeper.clone(), route[11].clone()], &[&seeds])?;
    }
    if route[1].lamports() != preserved ||
        preserved < Rent::get()?.minimum_balance(0).checked_add(available - spend).ok_or_else(overflow)? {
        return Err(bad_account());
    }
    series.premium_spent_lamports = series.premium_spent_lamports.checked_add(spend).ok_or_else(overflow)?;
    save(state, &series)
}

fn reclaim_pump_swap_quote_rent(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    if accounts.len() != 5 { return Err(invalid()); }
    let state = &accounts[0];
    let quote_vault = &accounts[1];
    let authority = &accounts[2];
    let issuer = &accounts[3];
    let token_program = &accounts[4];
    let series = load_series(program_id, state)?;
    let total = series.sold_lots.checked_mul(series.premium_lamports).ok_or_else(overflow)?;
    if Clock::get()?.slot <= series.expiry_slot ||
        total != series.premium_spent_lamports.checked_add(series.premium_refunded_lamports).ok_or_else(overflow)? ||
        *issuer.key != series.issuer || !issuer.is_writable || !quote_vault.is_writable ||
        token_program.key != &token_legacy::id() { return Err(invalid()); }
    let (buyer, bump) = Pubkey::find_program_address(&[b"buyback", state.key.as_ref()], program_id);
    if *authority.key != buyer || *quote_vault.key != ata(&wrapped_sol::id(), &buyer, &token_legacy::id()) ||
        legacy_vault_token_data(quote_vault, &wrapped_sol::id(), &buyer)? != 0 { return Err(bad_account()); }
    let close = Instruction { program_id: token_legacy::id(), accounts: vec![
        AccountMeta::new(*quote_vault.key, false), AccountMeta::new(*issuer.key, false),
        AccountMeta::new_readonly(*authority.key, true),
    ], data: vec![9] };
    let bump_seed = [bump];
    let seeds = [b"buyback".as_ref(), state.key.as_ref(), bump_seed.as_ref()];
    invoke_signed(&close, &[quote_vault.clone(), issuer.clone(), authority.clone(), token_program.clone()], &[&seeds])
}

fn reclaim_buyback_rent(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    if accounts.len() != 4 { return Err(invalid()); }
    let state = &accounts[0];
    let buyback_user = &accounts[1];
    let issuer = &accounts[2];
    let system = &accounts[3];
    let series = load_series(program_id, state)?;
    if Clock::get()?.slot <= series.expiry_slot || *issuer.key != series.issuer || !issuer.is_writable ||
        !buyback_user.is_writable || system.key != &solana_system_interface::program::id() {
        return Err(invalid());
    }
    let (expected, bump) = Pubkey::find_program_address(&[b"buyback", state.key.as_ref()], program_id);
    if *buyback_user.key != expected || buyback_user.owner != &solana_system_interface::program::id() || buyback_user.data_len() != 0 {
        return Err(bad_account());
    }
    let total = series.sold_lots.checked_mul(series.premium_lamports).ok_or_else(overflow)?;
    if total != series.premium_spent_lamports.checked_add(series.premium_refunded_lamports).ok_or_else(overflow)? {
        return Err(invalid());
    }
    let amount = buyback_user.lamports();
    if amount == 0 { return Err(invalid()); }
    let bump_seed = [bump];
    let seeds = [b"buyback".as_ref(), state.key.as_ref(), bump_seed.as_ref()];
    let ix = system_instruction::transfer(buyback_user.key, issuer.key, amount);
    invoke_signed(&ix, &[buyback_user.clone(), issuer.clone(), system.clone()], &[&seeds])
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
        6 if payload.is_empty() => claim_premium_refund(program_id, accounts),
        7 => buyback_on_pump(program_id, accounts, payload),
        8 if payload.is_empty() => reclaim_buyback_rent(program_id, accounts),
        9 => buyback_on_pump_swap(program_id, accounts, payload),
        10 if payload.is_empty() => reclaim_pump_swap_quote_rent(program_id, accounts),
        11 if payload.is_empty() => withdraw_registered_treasury(program_id, accounts),
        _ => Err(invalid()),
    }
}

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pump_curve_strike_matches_one_token_quote_and_rejects_wrong_curve() {
        let mut curve = vec![0_u8; 115];
        curve[..8].copy_from_slice(&[23, 183, 248, 55, 96, 216, 172, 96]);
        curve[8..16].copy_from_slice(&1_073_000_000_000_000_u64.to_le_bytes());
        curve[16..24].copy_from_slice(&30_000_000_000_u64.to_le_bytes());
        curve[24..32].copy_from_slice(&793_000_000_000_000_u64.to_le_bytes());
        curve[83..115].copy_from_slice(solana_system_interface::program::id().as_ref());
        let expected = 1_000_000_u128 * 30_000_000_000 / (1_073_000_000_000_000 - 1_000_000) + 1;
        assert_eq!(pump_curve_strike(&curve, 1_000_000).unwrap(), expected as u64);
        curve[48] = 1;
        assert!(pump_curve_strike(&curve, 1_000_000).is_err());
        curve[48] = 0;
        curve[83..115].copy_from_slice(Pubkey::new_unique().as_ref());
        assert!(pump_curve_strike(&curve, 1_000_000).is_err());
        curve[83..115].copy_from_slice(wrapped_sol::id().as_ref());
        curve[24..32].copy_from_slice(&999_999_u64.to_le_bytes());
        assert!(pump_curve_strike(&curve, 1_000_000).is_err());
    }

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
        let position = Position { tag: POSITION_TAG, bump: 1, series: Pubkey::new_unique(), buyer: Pubkey::new_unique(), bought_lots: 5, exercised_lots: 2, default_claimed_lots: 1, premium_refunded: 0 };
        assert_eq!(position_remaining(&position).unwrap(), 2);
        let invalid = Position { default_claimed_lots: 4, ..position };
        assert!(position_remaining(&invalid).is_err());
    }

    #[test]
    fn missing_custody_treasury_counts_as_a_breach() {
        let issuer = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let treasury = Pubkey::new_unique();
        let authority = Pubkey::new_unique();
        let series = Series {
            tag: SERIES_TAG, status: STATUS_ACTIVE, bump: 0, nonce: 0,
            issuer, mint, vault: Pubkey::new_unique(), treasury,
            treasury_floor: 50, supply_snapshot: 1_000, lot_size: 1,
            total_lots: 20, sold_lots: 0, exercised_lots: 0,
            default_claimed_lots: 0, reclaimed_lots: 0,
            sale_deadline_slot: 10, expiry_slot: 20,
            strike_lamports: 100, premium_lamports: 10,
            premium_spent_lamports: 0, premium_refunded_lamports: 0, premium_refund_claimed_lots: 0,
        };
        let mut lamports = 1;
        let mut data = [0u8; 165];
        data[..32].copy_from_slice(mint.as_ref());
        data[32..64].copy_from_slice(authority.as_ref());
        data[64..72].copy_from_slice(&50_u64.to_le_bytes());
        data[108] = 1;
        let token_id = token_2022::id();
        let account = AccountInfo::new(&treasury, false, false, &mut lamports, &mut data, &token_id, false);
        assert!(!treasury_breached(&account, &series, &authority));
        account.try_borrow_mut_data().unwrap()[64..72].copy_from_slice(&49_u64.to_le_bytes());
        assert!(treasury_breached(&account, &series, &authority));
        drop(account);
        let mut closed_data = [];
        let system_id = solana_system_interface::program::id();
        let closed = AccountInfo::new(&treasury, false, false, &mut lamports, &mut closed_data, &system_id, false);
        assert!(treasury_breached(&closed, &series, &authority));
    }

    #[test]
    fn vault_rejects_preapproved_delegate_or_allowance() {
        let mint = Pubkey::new_unique();
        let authority = Pubkey::new_unique();
        let address = Pubkey::new_unique();
        let mut lamports = 1;
        let mut data = [0_u8; 165];
        data[..32].copy_from_slice(mint.as_ref());
        data[32..64].copy_from_slice(authority.as_ref());
        data[108] = 1;
        let token_id = token_2022::id();
        let account = AccountInfo::new(&address, false, false, &mut lamports, &mut data, &token_id, false);
        assert_eq!(vault_token_data(&account, &mint, &authority).unwrap(), 0);
        account.try_borrow_mut_data().unwrap()[72..76].copy_from_slice(&1_u32.to_le_bytes());
        assert!(vault_token_data(&account, &mint, &authority).is_err());
        account.try_borrow_mut_data().unwrap()[72..76].fill(0);
        account.try_borrow_mut_data().unwrap()[121..129].copy_from_slice(&1_u64.to_le_bytes());
        assert!(vault_token_data(&account, &mint, &authority).is_err());
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

    #[test]
    fn premium_refund_rounding_preserves_the_remaining_pool() {
        let mut series = Series {
            tag: SERIES_TAG, status: STATUS_CLOSED, bump: 0, nonce: 0,
            issuer: Pubkey::new_unique(), mint: Pubkey::new_unique(),
            vault: Pubkey::new_unique(), treasury: Pubkey::new_unique(),
            treasury_floor: 1, supply_snapshot: 100, lot_size: 1,
            total_lots: 4, sold_lots: 4, exercised_lots: 0,
            default_claimed_lots: 0, reclaimed_lots: 4,
            sale_deadline_slot: 10, expiry_slot: 20,
            strike_lamports: 100, premium_lamports: 10,
            premium_spent_lamports: 6, premium_refunded_lamports: 0,
            premium_refund_claimed_lots: 0,
        };
        let mut position = Position {
            tag: POSITION_TAG, bump: 0, series: Pubkey::new_unique(),
            buyer: Pubkey::new_unique(), bought_lots: 2,
            exercised_lots: 1, default_claimed_lots: 0, premium_refunded: 0,
        };
        let (first, lots) = refund_entitlement(&series, &position).unwrap();
        assert_eq!(first, 17);
        series.premium_refunded_lamports += first;
        series.premium_refund_claimed_lots = lots;
        position.premium_refunded = 1;
        assert!(refund_entitlement(&series, &position).is_err());
        position.premium_refunded = 0;
        position.bought_lots = 1;
        let (second, lots) = refund_entitlement(&series, &position).unwrap();
        assert_eq!(second, 8);
        series.premium_refunded_lamports += second;
        series.premium_refund_claimed_lots = lots;
        let (last, final_lots) = refund_entitlement(&series, &position).unwrap();
        assert_eq!(last, 9);
        assert_eq!(first + second + last, 34);
        assert_eq!(final_lots, series.sold_lots);
    }

    #[test]
    fn zero_value_refund_can_advance_to_the_final_claimant() {
        let mut series = Series {
            tag: SERIES_TAG, status: STATUS_CLOSED, bump: 0, nonce: 0,
            issuer: Pubkey::new_unique(), mint: Pubkey::new_unique(),
            vault: Pubkey::new_unique(), treasury: Pubkey::new_unique(),
            treasury_floor: 1, supply_snapshot: 100, lot_size: 1,
            total_lots: 3, sold_lots: 3, exercised_lots: 0,
            default_claimed_lots: 0, reclaimed_lots: 3,
            sale_deadline_slot: 10, expiry_slot: 20,
            strike_lamports: 10, premium_lamports: 1,
            premium_spent_lamports: 2, premium_refunded_lamports: 0,
            premium_refund_claimed_lots: 0,
        };
        let position = Position {
            tag: POSITION_TAG, bump: 0, series: Pubkey::new_unique(),
            buyer: Pubkey::new_unique(), bought_lots: 1,
            exercised_lots: 0, default_claimed_lots: 0, premium_refunded: 0,
        };
        for claimed in 1..=2 {
            let (amount, lots) = refund_entitlement(&series, &position).unwrap();
            assert_eq!(amount, 0);
            assert_eq!(lots, claimed);
            series.premium_refund_claimed_lots = lots;
        }
        let (amount, lots) = refund_entitlement(&series, &position).unwrap();
        assert_eq!((amount, lots), (1, 3));
    }
}
