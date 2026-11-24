import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';

const encoder = new TextEncoder();
const MAX_U64 = (1n << 64n) - 1n;

export function key(value) { return value instanceof PublicKey ? value : new PublicKey(value); }
export function u64(value) {
  const number = BigInt(value);
  if (number < 0n || number > MAX_U64) throw new RangeError('Value must fit in unsigned 64 bits');
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(number);
  return bytes;
}
export function instruction(programId, op, metas, ...fields) {
  return new TransactionInstruction({ programId: key(programId), keys: metas, data: Buffer.concat([Buffer.from([op]), ...fields.map(u64)]) });
}
export function meta(pubkey, isSigner = false, isWritable = false) { return { pubkey: key(pubkey), isSigner, isWritable }; }

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

export function decodePosition(data) {
  const bytes = Buffer.from(data);
  if (bytes.length !== 98 || bytes.subarray(0, 8).toString() !== 'HMONPOS2') throw new Error('Invalid h/monhook option position account');
  return { bump: bytes[8], series: new PublicKey(bytes.subarray(9, 41)),
    buyer: new PublicKey(bytes.subarray(41, 73)), boughtLots: bytes.readBigUInt64LE(73),
    exercisedLots: bytes.readBigUInt64LE(81), defaultClaimedLots: bytes.readBigUInt64LE(89),
    premiumRefunded: bytes[97] === 1 };
}

export async function fetchVerifiedPosition(connection, programId, series, buyer) {
  const [address, bump] = PublicKey.findProgramAddressSync([
    encoder.encode('position'), key(series).toBuffer(), key(buyer).toBuffer(),
  ], key(programId));
  const info = await connection.getAccountInfo(address, 'confirmed');
  if (!info) return null;
  if (!info.owner.equals(key(programId))) throw new Error('Option position has an unexpected owner');
  const position = decodePosition(info.data);
  if (position.bump !== bump || !position.series.equals(key(series)) || !position.buyer.equals(key(buyer))) {
    throw new Error('Option position does not match this series and buyer');
  }
  return { address, ...position };
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
