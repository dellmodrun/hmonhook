//! Local-validator test double for Pump's exact-quote-in instruction.
//! This fixture does not model Pump pricing or fees and must never be deployed publicly.
use solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction}, program::invoke, program::invoke_signed,
    program_error::ProgramError, pubkey::Pubkey, sysvar::{rent::Rent, Sysvar},
};
use solana_system_interface::instruction as system_instruction;

fn read_u64(data: &[u8], start: usize) -> Result<u64, ProgramError> {
    let bytes: [u8; 8] = data.get(start..start + 8).ok_or(ProgramError::InvalidInstructionData)?
        .try_into().map_err(|_| ProgramError::InvalidInstructionData)?;
    Ok(u64::from_le_bytes(bytes))
}

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() == 25 && data[0] == 0 && accounts.len() == 4 {
        let payer = &accounts[0];
        let mint = &accounts[1];
        let curve = &accounts[2];
        let system = &accounts[3];
        if !payer.is_signer || !payer.is_writable || !curve.is_writable ||
            *system.key != solana_system_interface::program::id() {
            return Err(ProgramError::InvalidAccountData);
        }
        let (expected, bump) = Pubkey::find_program_address(&[b"bonding-curve", mint.key.as_ref()], program_id);
        if expected != *curve.key { return Err(ProgramError::InvalidAccountData); }
        let seeds = [b"bonding-curve".as_ref(), mint.key.as_ref(), &[bump]];
        let create = system_instruction::create_account(payer.key, curve.key,
            Rent::get()?.minimum_balance(115), 115, program_id);
        invoke_signed(&create, &[payer.clone(), curve.clone(), system.clone()], &[&seeds])?;
        let mut bytes = curve.try_borrow_mut_data()?;
        bytes[..8].copy_from_slice(&[23, 183, 248, 55, 96, 216, 172, 96]);
        bytes[8..16].copy_from_slice(&data[1..9]);
        bytes[16..24].copy_from_slice(&data[9..17]);
        bytes[24..32].copy_from_slice(&data[17..25]);
        bytes[83..115].copy_from_slice(system.key.as_ref());
        return Ok(());
    }
    if data.len() != 25 || data[..8] != [0xe1, 0xf7, 0x50, 0x1e, 0xd5, 0xb3, 0x84, 0x88] ||
        data[24] != 0 || accounts.len() != 17 { return Err(ProgramError::InvalidInstructionData); }
    let spend = read_u64(data, 8)?;
    let amount = read_u64(data, 16)?;
    if !accounts[8].is_signer || spend == 0 || amount == 0 { return Err(ProgramError::MissingRequiredSignature); }
    let curve = &accounts[5];
    let user = &accounts[8];
    let system = &accounts[14];
    invoke(&system_instruction::transfer(user.key, curve.key, spend), &[user.clone(), curve.clone(), system.clone()])?;

    let decimals = accounts[1].try_borrow_data()?[44];
    let mut transfer = vec![12];
    transfer.extend_from_slice(&amount.to_le_bytes());
    transfer.push(decimals);
    let token = Instruction { program_id: *accounts[3].key, accounts: vec![
        AccountMeta::new(*accounts[6].key, false),
        AccountMeta::new_readonly(*accounts[1].key, false),
        AccountMeta::new(*accounts[9].key, false),
        AccountMeta::new_readonly(*curve.key, true),
    ], data: transfer };
    let bump = Pubkey::find_program_address(&[b"bonding-curve", accounts[1].key.as_ref()], program_id).1;
    let seeds = [b"bonding-curve".as_ref(), accounts[1].key.as_ref(), &[bump]];
    invoke_signed(&token, &[accounts[6].clone(), accounts[1].clone(), accounts[9].clone(), curve.clone(), accounts[3].clone()], &[&seeds])
}

entrypoint!(process_instruction);
