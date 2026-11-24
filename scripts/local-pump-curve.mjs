// Local-validator fixture only. Requires mock-pump loaded at the official Pump address.
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

export const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const MOCK_STRIKE_LAMPORTS = 1_000n;

export function createMockPumpCurve({ payer, mint }) {
  const [curve] = PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), mint.toBuffer()], PUMP_PROGRAM_ID);
  const data = Buffer.alloc(25);
  data[0] = 0;
  data.writeBigUInt64LE(1_001_000_000n, 1); // virtual tokens
  data.writeBigUInt64LE(999_000n, 9);       // virtual quote
  data.writeBigUInt64LE(1_000_000_000n, 17); // real tokens
  return { curve, instruction: new TransactionInstruction({ programId: PUMP_PROGRAM_ID, keys: [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: curve, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ], data }) };
}
