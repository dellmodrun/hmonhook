import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { createRequire } from 'node:module';
import BN from 'bn.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { fetchPumpStrikeSuggestion } from './options-strike.mjs';
import { key, u64, instruction, meta, deriveBuybackVault, openSeriesInstructions } from './options-core.mjs';
export * from './options-core.mjs';
export { fetchPumpStrikeSuggestion } from './options-strike.mjs';
const { PUMP_PROGRAM_ID, PUMP_SDK } = createRequire(import.meta.url)('@pump-fun/pump-sdk');
const { PUMP_AMM_PROGRAM_ID, PUMP_AMM_SDK, canonicalPumpPoolPda, PUMP_AMM_FEE_CONFIG_PDA,
  GLOBAL_CONFIG_PDA, PUMP_AMM_EVENT_AUTHORITY_PDA, userVolumeAccumulatorPda } =
  createRequire(import.meta.url)('@pump-fun/pump-swap-sdk');
const OFFICIAL_PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_BUYBACK_FEE_RECIPIENT = new PublicKey('5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD');

// This is the Pump CPI payload for the development program, not a standalone
// wallet transaction. The PDA can sign only inside h/monhook's own instruction.
export async function buildPumpBuybackRoute({ programId, series, mint, spendableQuoteIn, minTokensOut }) {
  u64(spendableQuoteIn);
  u64(minTokensOut);
  if (BigInt(spendableQuoteIn) === 0n || BigInt(minTokensOut) === 0n) throw new RangeError('Buyback input and minimum output must be positive.');
  const vault = deriveBuybackVault(programId, series, mint);
  const route = await PUMP_SDK.getBuyExactQuoteInV3InstructionRaw({
    user: vault.authority, mint: key(mint),
    spendableQuoteIn: new BN(String(spendableQuoteIn)),
    minTokensOut: new BN(String(minTokensOut)),
  });
  route.keys[13] = { ...route.keys[13], pubkey: PUMP_BUYBACK_FEE_RECIPIENT };
  const expected = [
    [1, key(mint)], [2, NATIVE_MINT], [3, TOKEN_2022_PROGRAM_ID],
    [4, TOKEN_PROGRAM_ID], [8, vault.authority], [9, vault.baseVault], [10, vault.quoteVault],
    [12, new PublicKey('8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt')],
    [13, PUMP_BUYBACK_FEE_RECIPIENT],
    [14, SystemProgram.programId], [16, OFFICIAL_PUMP_PROGRAM_ID],
  ];
  if (!PUMP_PROGRAM_ID.equals(OFFICIAL_PUMP_PROGRAM_ID) || !route.programId.equals(OFFICIAL_PUMP_PROGRAM_ID) || route.keys.length !== 17 ||
    Buffer.from(route.data).subarray(0, 8).toString('hex') !== 'e1f7501ed5b38488' ||
    expected.some(([index, address]) => !route.keys[index].pubkey.equals(address))) {
    throw new Error('Pump buyback route no longer matches the reviewed program and vault layout.');
  }
  return { vault, route };
}

export async function pumpBuybackInstruction({ programId, series, mint, keeper, spendableQuoteIn, minTokensOut, keeperTopupLamports, strikeLamports, lotSize }) {
  const spend = BigInt(spendableQuoteIn);
  const minimum = BigInt(minTokensOut);
  const topup = BigInt(keeperTopupLamports);
  const strike = BigInt(strikeLamports);
  const lot = BigInt(lotSize);
  if (strike <= 0n || lot <= 0n || topup < 0n || topup > 20_000_000n) throw new RangeError('Invalid buyback terms or keeper rent allowance.');
  if (minimum < (spend * lot + 2n * strike - 1n) / (2n * strike)) {
    throw new RangeError('Minimum output exceeds the series maximum buyback price.');
  }
  const { vault, route } = await buildPumpBuybackRoute({ programId, series, mint, spendableQuoteIn: spend, minTokensOut: minimum });
  const outer = instruction(programId, 7, [
    meta(keeper, true, true), meta(series, false, true),
    ...route.keys.map((account) => meta(account.pubkey, false, account.isWritable)),
  ], spend, minimum, topup);
  return { vault, route, instruction: outer };
}

// The installed Pump SDK predates PumpSwap trade V2, so assemble the official
// 17-account instruction and validate its canonical pool before it is signed.
export async function buildPumpSwapBuybackRoute({ connection, programId, series, mint, spendableQuoteIn, minTokensOut }) {
  const spend = BigInt(spendableQuoteIn);
  const minimum = BigInt(minTokensOut);
  u64(spend);
  u64(minimum);
  if (spend === 0n || minimum === 0n) throw new RangeError('Buyback input and minimum output must be positive.');
  const vault = deriveBuybackVault(programId, series, mint);
  const pool = canonicalPumpPoolPda(key(mint));
  const info = await connection.getAccountInfo(pool, 'confirmed');
  if (!info || !info.owner.equals(PUMP_AMM_PROGRAM_ID)) throw new Error('Canonical PumpSwap pool is missing.');
  const decoded = PUMP_AMM_SDK.decodePool(info);
  if (!decoded.baseMint.equals(key(mint)) || !decoded.quoteMint.equals(NATIVE_MINT) ||
      !decoded.creator.equals(PublicKey.findProgramAddressSync([Buffer.from('pool-authority'), key(mint).toBuffer()], OFFICIAL_PUMP_PROGRAM_ID)[0]) ||
      Number(decoded.index) !== 0 || decoded.isCashbackCoin) {
    throw new Error('Pool is not a supported canonical SOL-quoted Pump coin.');
  }
  const feeVault = getAssociatedTokenAddressSync(NATIVE_MINT, PUMP_BUYBACK_FEE_RECIPIENT, true, TOKEN_PROGRAM_ID);
  const addresses = [pool, vault.authority, GLOBAL_CONFIG_PDA, key(mint), NATIVE_MINT,
    vault.baseVault, vault.quoteVault, decoded.poolBaseTokenAccount, decoded.poolQuoteTokenAccount,
    TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, SystemProgram.programId,
    userVolumeAccumulatorPda(vault.authority), PUMP_AMM_FEE_CONFIG_PDA,
    feeVault, PUMP_AMM_EVENT_AUTHORITY_PDA, PUMP_AMM_PROGRAM_ID];
  const writable = new Set([0, 1, 5, 6, 7, 8, 12, 14]);
  const route = new TransactionInstruction({ programId: PUMP_AMM_PROGRAM_ID,
    keys: addresses.map((address, index) => meta(address, index === 1, writable.has(index))),
    data: Buffer.concat([Buffer.from('c2ab1c46684d5b2f', 'hex'), u64(spend), u64(minimum)]) });
  return { vault, pool, route };
}

export async function pumpSwapBuybackInstruction({ connection, programId, series, mint, keeper, spendableQuoteIn, minTokensOut, keeperTopupLamports, strikeLamports, lotSize }) {
  const spend = BigInt(spendableQuoteIn);
  const minimum = BigInt(minTokensOut);
  const topup = BigInt(keeperTopupLamports);
  const strike = BigInt(strikeLamports);
  const lot = BigInt(lotSize);
  if (strike <= 0n || lot <= 0n || topup < 0n || topup > 20_000_000n) throw new RangeError('Invalid buyback terms or keeper rent allowance.');
  if (minimum < (spend * lot + 2n * strike - 1n) / (2n * strike)) {
    throw new RangeError('Minimum output exceeds the series maximum buyback price.');
  }
  const { vault, pool, route } = await buildPumpSwapBuybackRoute({ connection, programId, series, mint,
    spendableQuoteIn: spend, minTokensOut: minimum });
  const outer = instruction(programId, 9, [meta(keeper, true, true), meta(series, false, true),
    ...route.keys.map((account) => meta(account.pubkey, false, account.isWritable))], spend, minimum, topup);
  return { vault, pool, route, instruction: outer };
}

export async function openSeriesFromPumpCurve(connection, args) {
  const strikeSnapshot = await fetchPumpStrikeSuggestion(connection, args.mint);
  const opened = openSeriesInstructions({ ...args, strikeLamports: strikeSnapshot.strikeLamports });
  return { ...opened, strikeSnapshot };
}
