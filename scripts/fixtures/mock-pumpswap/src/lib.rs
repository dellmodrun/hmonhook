//! Local-validator test double for PumpSwap buy_exact_quote_in_v2.
//! It only models exact quote spending and token output. Never deploy it publicly.
use solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction}, program::{invoke, invoke_signed},
    program_error::ProgramError, pubkey::Pubkey, sysvar::{rent::Rent, Sysvar},
};
use solana_system_interface::instruction as system_instruction;

fn key(value: &str) -> Pubkey { value.parse().unwrap() }
fn u64_at(data: &[u8], offset: usize) -> Result<u64, ProgramError> {
    Ok(u64::from_le_bytes(data.get(offset..offset + 8).ok_or(ProgramError::InvalidInstructionData)?
        .try_into().map_err(|_| ProgramError::InvalidInstructionData)?))
}

fn create_pool(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    if accounts.len() != 6 { return Err(ProgramError::NotEnoughAccountKeys); }
    let payer = &accounts[0];
    let pool = &accounts[1];
    let mint = &accounts[2];
    let base = &accounts[3];
    let quote = &accounts[4];
    let system = &accounts[5];
    let pump = key("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
    let wsol = key("So11111111111111111111111111111111111111112");
    let creator = Pubkey::find_program_address(&[b"pool-authority", mint.key.as_ref()], &pump).0;
    let (expected, bump) = Pubkey::find_program_address(&[
        b"pool", &0_u16.to_le_bytes(), creator.as_ref(), mint.key.as_ref(), wsol.as_ref(),
    ], program_id);
    if !payer.is_signer || expected != *pool.key { return Err(ProgramError::InvalidAccountData); }
    let bump_seed = [bump];
    let seeds = [b"pool".as_ref(), &0_u16.to_le_bytes(), creator.as_ref(), mint.key.as_ref(), wsol.as_ref(), bump_seed.as_ref()];
    let ix = system_instruction::create_account(payer.key, pool.key, Rent::get()?.minimum_balance(270), 270, program_id);
    invoke_signed(&ix, &[payer.clone(), pool.clone(), system.clone()], &[&seeds])?;
    let mut data = pool.try_borrow_mut_data()?;
    data[0..8].copy_from_slice(&[241, 154, 109, 4, 17, 177, 109, 188]);
    data[8] = bump;
    data[11..43].copy_from_slice(creator.as_ref());
    data[43..75].copy_from_slice(mint.key.as_ref());
    data[75..107].copy_from_slice(wsol.as_ref());
    data[139..171].copy_from_slice(base.key.as_ref());
    data[171..203].copy_from_slice(quote.key.as_ref());
    Ok(())
}

fn buy(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != 24 || accounts.len() != 17 || data[..8] != [0xc2, 0xab, 0x1c, 0x46, 0x68, 0x4d, 0x5b, 0x2f] {
        return Err(ProgramError::InvalidInstructionData);
    }
    let spend = u64_at(data, 8)?;
    let minimum = u64_at(data, 16)?;
    let amount = 1_000_000_u64;
    if !accounts[1].is_signer || spend == 0 || minimum > amount { return Err(ProgramError::InvalidInstructionData); }
    let quote_transfer = Instruction { program_id: *accounts[10].key, accounts: vec![
        AccountMeta::new(*accounts[6].key, false), AccountMeta::new_readonly(*accounts[4].key, false),
        AccountMeta::new(*accounts[8].key, false), AccountMeta::new_readonly(*accounts[1].key, true),
    ], data: { let mut value = vec![12]; value.extend_from_slice(&spend.to_le_bytes()); value.push(9); value } };
    invoke(&quote_transfer, &[accounts[6].clone(), accounts[4].clone(), accounts[8].clone(), accounts[1].clone(), accounts[10].clone()])?;

    let mint = &accounts[3];
    let pump = key("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
    let wsol = key("So11111111111111111111111111111111111111112");
    let creator = Pubkey::find_program_address(&[b"pool-authority", mint.key.as_ref()], &pump).0;
    let bump = Pubkey::find_program_address(&[b"pool", &0_u16.to_le_bytes(), creator.as_ref(), mint.key.as_ref(), wsol.as_ref()], program_id).1;
    let bump_seed = [bump];
    let seeds = [b"pool".as_ref(), &0_u16.to_le_bytes(), creator.as_ref(), mint.key.as_ref(), wsol.as_ref(), bump_seed.as_ref()];
    let decimals = mint.try_borrow_data()?[44];
    let base_transfer = Instruction { program_id: *accounts[9].key, accounts: vec![
        AccountMeta::new(*accounts[7].key, false), AccountMeta::new_readonly(*mint.key, false),
        AccountMeta::new(*accounts[5].key, false), AccountMeta::new_readonly(*accounts[0].key, true),
    ], data: { let mut value = vec![12]; value.extend_from_slice(&amount.to_le_bytes()); value.push(decimals); value } };
    invoke_signed(&base_transfer, &[accounts[7].clone(), mint.clone(), accounts[5].clone(), accounts[0].clone(), accounts[9].clone()], &[&seeds])
}

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data == [0] { create_pool(program_id, accounts) } else { buy(program_id, accounts, data) }
}
entrypoint!(process_instruction);
