import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { createRequire } from 'node:module';
const { PUMP_PROGRAM_ID, PUMP_SDK } = createRequire(import.meta.url)('@pump-fun/pump-sdk');
const { PUMP_AMM_PROGRAM_ID, PUMP_AMM_SDK, canonicalPumpPoolPda, PUMP_AMM_FEE_CONFIG_PDA,
  GLOBAL_CONFIG_PDA, PUMP_AMM_EVENT_AUTHORITY_PDA, userVolumeAccumulatorPda } =
  createRequire(import.meta.url)('@pump-fun/pump-swap-sdk');
import BN from 'bn.js';
import {
  NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';
import { fetchPumpStrikeSuggestion } from './options-strike.mjs';

export { fetchPumpStrikeSuggestion } from './options-strike.mjs';

const encoder = new TextEncoder();
const MAX_U64 = (1n << 64n) - 1n;
const OFFICIAL_PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_BUYBACK_FEE_RECIPIENT = new PublicKey('5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD');

function key(value) { return value instanceof PublicKey ? value : new PublicKey(value); }
function u64(value) {
  const number = BigInt(value);
  if (number < 0n || number > MAX_U64) throw new RangeError('Value must fit in unsigned 64 bits');
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(number);
  return bytes;
}
function instruction(programId, op, metas, ...fields) {
  return new TransactionInstruction({ programId: key(programId), keys: metas, data: Buffer.concat([Buffer.from([op]), ...fields.map(u64)]) });
}
function meta(pubkey, isSigner = false, isWritable = false) { return { pubkey: key(pubkey), isSigner, isWritable }; }

export function deriveSeries(programId, mint, issuer, nonce) {
  const [address, bump] = PublicKey.findProgramAddressSync([
    encoder.encode('series'), key(mint).toBuffer(), key(issuer).toBuffer(), u64(nonce),
  ], key(programId));
  return { address, bump, vault: getAssociatedTokenAddressSync(key(mint), address, true, TOKEN_2022_PROGRAM_ID) };
}

export function derivePosition(programId, series, buyer) {
  return PublicKey.findProgramAddressSync([encoder.encode('position'), key(series).toBuffer(), key(buyer).toBuffer()], key(programId))[0];
}

export function deriveBuybackVault(programId, series, mint) {
  const [authority, bump] = PublicKey.findProgramAddressSync([
    encoder.encode('buyback'), key(series).toBuffer(),
  ], key(programId));
  return {
    authority, bump,
    baseVault: getAssociatedTokenAddressSync(key(mint), authority, true, TOKEN_2022_PROGRAM_ID),
    quoteVault: getAssociatedTokenAddressSync(NATIVE_MINT, authority, true, TOKEN_PROGRAM_ID),
  };
}

export function deriveBuybackAuthority(programId, series) {
  return PublicKey.findProgramAddressSync([encoder.encode('buyback'), key(series).toBuffer()], key(programId))[0];
}

export function buybackVaultPrepInstructions({ programId, series, mint, payer }) {
  const vault = deriveBuybackVault(programId, series, mint);
  return { vault, instructions: [
    createAssociatedTokenAccountIdempotentInstruction(key(payer), vault.baseVault, vault.authority, key(mint), TOKEN_2022_PROGRAM_ID),
  ] };
}

export function pumpSwapVaultPrepInstructions({ programId, series, mint, payer }) {
  const vault = deriveBuybackVault(programId, series, mint);
  return { vault, instructions: [
    createAssociatedTokenAccountIdempotentInstruction(key(payer), vault.baseVault, vault.authority, key(mint), TOKEN_2022_PROGRAM_ID),
    createAssociatedTokenAccountIdempotentInstruction(key(payer), vault.quoteVault, vault.authority, NATIVE_MINT, TOKEN_PROGRAM_ID),
  ] };
}

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

export function reclaimPumpSwapQuoteRentInstruction({ programId, series, mint, issuer }) {
  const vault = deriveBuybackVault(programId, series, mint);
  return instruction(programId, 10, [meta(series), meta(vault.quoteVault, false, true),
    meta(vault.authority), meta(issuer, false, true), meta(TOKEN_PROGRAM_ID)]);
}

export function openSeriesInstructions({ programId, issuer, mint, source, treasury, nonce, deposit, strikeLamports, saleDeadlineSlot, expirySlot, treasuryFloor }) {
  if (!key(source).equals(key(treasury))) {
    throw new Error('The collateral source must be the monitored issuer treasury.');
  }
  const series = deriveSeries(programId, mint, issuer, nonce);
  const buyback = deriveBuybackAuthority(programId, series.address);
  const createVault = createAssociatedTokenAccountIdempotentInstruction(key(issuer), series.vault, series.address, key(mint), TOKEN_2022_PROGRAM_ID);
  const initialize = instruction(programId, 0, [
    meta(issuer, true, true), meta(mint), meta(source, false, true), meta(series.vault, false, true),
    meta(treasury), meta(series.address, false, true), meta(buyback, false, true), meta(TOKEN_2022_PROGRAM_ID), meta(SystemProgram.programId),
  ], nonce, deposit, strikeLamports, saleDeadlineSlot, expirySlot, treasuryFloor);
  return { series, instructions: [createVault, initialize] };
}

export async function openSeriesFromPumpCurve(connection, args) {
  const strikeSnapshot = await fetchPumpStrikeSuggestion(connection, args.mint);
  const opened = openSeriesInstructions({ ...args, strikeLamports: strikeSnapshot.strikeLamports });
  return { ...opened, strikeSnapshot };
}

export function buyOptionsInstruction({ programId, series, buyer, treasury, lots }) {
  const position = derivePosition(programId, series, buyer);
  const premiums = deriveBuybackAuthority(programId, series);
  return instruction(programId, 1, [meta(buyer, true, true), meta(series, false, true), meta(position, false, true), meta(treasury), meta(premiums, false, true), meta(SystemProgram.programId)], lots);
}

function settleInstructions({ programId, series, mint, vault, issuer, buyer, lots }, op) {
  const position = derivePosition(programId, series, buyer);
  const destination = getAssociatedTokenAddressSync(key(mint), key(buyer), false, TOKEN_2022_PROGRAM_ID);
  return {
    destination,
    instructions: [
      createAssociatedTokenAccountIdempotentInstruction(key(buyer), destination, key(buyer), key(mint), TOKEN_2022_PROGRAM_ID),
      instruction(programId, op, [
        meta(buyer, true, true), meta(issuer, false, true), meta(series, false, true), meta(position, false, true),
        meta(mint), meta(vault, false, true), meta(destination, false, true), meta(TOKEN_2022_PROGRAM_ID), meta(SystemProgram.programId),
      ], lots),
    ],
  };
}

export function exerciseInstructions(args) { return settleInstructions(args, 2); }
export function claimDefaultInstructions(args) { return settleInstructions(args, 4); }

export function triggerDefaultInstruction({ programId, series, treasury }) {
  return instruction(programId, 3, [meta(series, false, true), meta(treasury)]);
}

export function reclaimInstructions({ programId, issuer, series, mint, vault }) {
  const destination = getAssociatedTokenAddressSync(key(mint), key(issuer), false, TOKEN_2022_PROGRAM_ID);
  return {
    destination,
    instructions: [
      createAssociatedTokenAccountIdempotentInstruction(key(issuer), destination, key(issuer), key(mint), TOKEN_2022_PROGRAM_ID),
      instruction(programId, 5, [meta(issuer, true), meta(series, false, true), meta(mint), meta(vault, false, true), meta(destination, false, true), meta(TOKEN_2022_PROGRAM_ID)]),
    ],
  };
}

export function refundPremiumInstruction({ programId, series, buyer }) {
  const position = derivePosition(programId, series, buyer);
  const premiums = deriveBuybackAuthority(programId, series);
  return instruction(programId, 6, [
    meta(buyer, true, true), meta(series, false, true), meta(position, false, true),
    meta(premiums, false, true), meta(SystemProgram.programId),
  ]);
}

export function reclaimBuybackRentInstruction({ programId, series, issuer }) {
  const premiums = deriveBuybackAuthority(programId, series);
  return instruction(programId, 8, [meta(series), meta(premiums, false, true),
    meta(issuer, false, true), meta(SystemProgram.programId)]);
}

export function decodeSeries(data) {
  const bytes = Buffer.from(data);
  if (bytes.length !== 266 || bytes.subarray(0, 8).toString() !== 'HMONOPT2') throw new Error('Invalid h/monhook option series account');
  let offset = 10;
  const readU64 = () => { const value = bytes.readBigUInt64LE(offset); offset += 8; return value; };
  const readKey = () => { const value = new PublicKey(bytes.subarray(offset, offset + 32)); offset += 32; return value; };
  const result = { status: bytes[8], bump: bytes[9], nonce: readU64(), issuer: readKey(), mint: readKey(), vault: readKey(), treasury: readKey() };
  for (const name of ['treasuryFloor', 'supplySnapshot', 'lotSize', 'totalLots', 'soldLots', 'exercisedLots', 'defaultClaimedLots', 'reclaimedLots', 'saleDeadlineSlot', 'expirySlot', 'strikeLamports', 'premiumLamports', 'premiumSpentLamports', 'premiumRefundedLamports', 'premiumRefundClaimedLots']) result[name] = readU64();
  return result;
}

export async function fetchVerifiedSeries(connection, programId, seriesAddress) {
  const info = await connection.getAccountInfo(key(seriesAddress), 'confirmed');
  if (!info || !info.owner.equals(key(programId))) throw new Error('Series is not owned by the h/monhook options program');
  const series = decodeSeries(info.data);
  const derived = deriveSeries(programId, series.mint, series.issuer, series.nonce);
  if (!derived.address.equals(key(seriesAddress)) || !derived.vault.equals(series.vault) || derived.bump !== series.bump) {
    throw new Error('Series PDA or collateral vault does not match its on-chain terms');
  }
  return series;
}

export async function listVerifiedSeriesByMint(connection, programId, mint) {
  const mintKey = key(mint);
  const rows = await connection.getProgramAccounts(key(programId), {
    commitment: 'confirmed',
    filters: [{ dataSize: 266 }, { memcmp: { offset: 50, bytes: mintKey.toBase58() } }],
  });
  return rows.flatMap(({ pubkey, account }) => {
    try {
      if (!account.owner.equals(key(programId))) return [];
      const series = decodeSeries(account.data);
      const derived = deriveSeries(programId, series.mint, series.issuer, series.nonce);
      if (!series.mint.equals(mintKey) || !derived.address.equals(pubkey) || !derived.vault.equals(series.vault) || derived.bump !== series.bump) return [];
      return [{ address: pubkey, ...series }];
    } catch (_) { return []; }
  });
}
