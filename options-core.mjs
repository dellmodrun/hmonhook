import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';

const encoder = new TextEncoder();
const MAX_U64 = (1n << 64n) - 1n;
const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

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
  return { address, bump, vault: getAssociatedTokenAddressSync(key(mint), address, true, TOKEN_2022_PROGRAM_ID),
    treasury: deriveRegisteredTreasury(programId, address) };
}

export function deriveRegisteredTreasury(programId, series) {
  return PublicKey.findProgramAddressSync([encoder.encode('treasury'), key(series).toBuffer()], key(programId))[0];
}

export function derivePosition(programId, series, buyer) {
  return PublicKey.findProgramAddressSync([encoder.encode('position'), key(series).toBuffer(), key(buyer).toBuffer()], key(programId))[0];
}
export function derivePumpCurve(mint) {
  return PublicKey.findProgramAddressSync([encoder.encode('bonding-curve'), key(mint).toBuffer()], PUMP_PROGRAM_ID)[0];
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

export function openSeriesInstructions({ programId, issuer, mint, source, nonce, deposit, strikeLamports, saleDeadlineSlot, expirySlot, treasuryFloor }) {
  const series = deriveSeries(programId, mint, issuer, nonce);
  const buyback = deriveBuybackAuthority(programId, series.address);
  const createVault = createAssociatedTokenAccountIdempotentInstruction(key(issuer), series.vault, series.address, key(mint), TOKEN_2022_PROGRAM_ID);
  const initialize = instruction(programId, 0, [
    meta(issuer, true, true), meta(mint), meta(source, false, true), meta(series.vault, false, true),
    meta(series.treasury, false, true), meta(series.address, false, true), meta(buyback, false, true), meta(TOKEN_2022_PROGRAM_ID), meta(SystemProgram.programId), meta(derivePumpCurve(mint)),
  ], nonce, deposit, strikeLamports, saleDeadlineSlot, expirySlot, treasuryFloor);
  return { series, instructions: [createVault, initialize] };
}

export function buyOptionsInstruction({ programId, series, buyer, lots }) {
  const position = derivePosition(programId, series, buyer);
  const premiums = deriveBuybackAuthority(programId, series);
  return instruction(programId, 1, [meta(buyer, true, true), meta(series, false, true), meta(position, false, true), meta(deriveRegisteredTreasury(programId, series)), meta(premiums, false, true), meta(SystemProgram.programId)], lots);
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

export function triggerDefaultInstruction({ programId, series }) {
  return instruction(programId, 3, [meta(series, false, true), meta(deriveRegisteredTreasury(programId, series))]);
}

export function withdrawRegisteredTreasuryInstruction({ programId, issuer, series, mint, destination }) {
  return instruction(programId, 11, [meta(issuer, true), meta(series, false, true), meta(mint),
    meta(deriveRegisteredTreasury(programId, series), false, true), meta(destination, false, true), meta(TOKEN_2022_PROGRAM_ID)]);
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

export function closePositionInstruction({ programId, series, buyer }) {
  return instruction(programId, 12, [meta(buyer, true, true), meta(series, false, true),
    meta(derivePosition(programId, series, buyer), false, true)]);
}

export function closeSeriesTokenInstruction({ programId, series, mint, issuer, kind }) {
  if (kind !== 'collateral' && kind !== 'treasury') throw new Error('Unknown series token account');
  const account = kind === 'collateral' ? deriveSeriesVault(mint, series) : deriveRegisteredTreasury(programId, series);
  return instruction(programId, 13, [meta(series), meta(mint), meta(account, false, true),
    meta(issuer, false, true), meta(TOKEN_2022_PROGRAM_ID)]);
}

function deriveSeriesVault(mint, series) {
  return getAssociatedTokenAddressSync(key(mint), key(series), true, TOKEN_2022_PROGRAM_ID);
}

export function closeEmptyBuybackVaultInstruction({ programId, series, mint, issuer }) {
  const vault = deriveBuybackVault(programId, series, mint);
  return instruction(programId, 14, [meta(series), meta(vault.baseVault, false, true),
    meta(vault.authority), meta(issuer, false, true), meta(TOKEN_2022_PROGRAM_ID)]);
}

export function closeSeriesInstruction({ programId, series, mint, issuer }) {
  const vault = deriveBuybackVault(programId, series, mint);
  return instruction(programId, 15, [meta(issuer, true, true), meta(series, false, true),
    meta(deriveSeriesVault(mint, series)), meta(deriveRegisteredTreasury(programId, series)),
    meta(vault.authority), meta(vault.baseVault), meta(vault.quoteVault)]);
}

export function decodeSeries(data) {
  const bytes = Buffer.from(data);
  if (bytes.length !== 274 || bytes.subarray(0, 8).toString() !== 'HMONOPT3') throw new Error('Invalid h/monhook option series account');
  if (bytes[8] > 2) throw new Error('Invalid h/monhook option series status');
  let offset = 10;
  const readU64 = () => { const value = bytes.readBigUInt64LE(offset); offset += 8; return value; };
  const readKey = () => { const value = new PublicKey(bytes.subarray(offset, offset + 32)); offset += 32; return value; };
  const result = { status: bytes[8], bump: bytes[9], nonce: readU64(), issuer: readKey(), mint: readKey(), vault: readKey(), treasury: readKey() };
  for (const name of ['treasuryFloor', 'supplySnapshot', 'lotSize', 'totalLots', 'soldLots', 'exercisedLots', 'defaultClaimedLots', 'reclaimedLots', 'saleDeadlineSlot', 'expirySlot', 'strikeLamports', 'premiumLamports', 'premiumSpentLamports', 'premiumRefundedLamports', 'premiumRefundClaimedLots', 'closedPositionLots']) result[name] = readU64();
  return result;
}

export function decodePosition(data) {
  const bytes = Buffer.from(data);
  if (bytes.length !== 98 || bytes.subarray(0, 8).toString() !== 'HMONPOS3') throw new Error('Invalid h/monhook option position account');
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
  if (!derived.address.equals(key(seriesAddress)) || !derived.vault.equals(series.vault) ||
    !derived.treasury.equals(series.treasury) || derived.bump !== series.bump) {
    throw new Error('Series PDA or collateral vault does not match its on-chain terms');
  }
  return series;
}

export async function listVerifiedSeriesByMint(connection, programId, mint) {
  const mintKey = key(mint);
  const rows = await connection.getProgramAccounts(key(programId), {
    commitment: 'confirmed',
    filters: [{ dataSize: 274 }, { memcmp: { offset: 50, bytes: mintKey.toBase58() } }],
  });
  return rows.flatMap(({ pubkey, account }) => {
    try {
      if (!account.owner.equals(key(programId))) return [];
      const series = decodeSeries(account.data);
      const derived = deriveSeries(programId, series.mint, series.issuer, series.nonce);
      if (!series.mint.equals(mintKey) || !derived.address.equals(pubkey) || !derived.vault.equals(series.vault) ||
        !derived.treasury.equals(series.treasury) || derived.bump !== series.bump) return [];
      return [{ address: pubkey, ...series }];
    } catch (_) { return []; }
  });
}

export async function listVerifiedDirectoryCandidates(connection, programId, mint, candidates) {
  if (!Array.isArray(candidates)) throw new Error('Invalid option directory response');
  const mintKey = key(mint);
  const seen = new Set();
  const addresses = [];
  for (const candidate of candidates.slice(0, 100)) {
    try {
      if (!candidate || typeof candidate.address !== 'string') continue;
      const address = key(candidate.address);
      const id = address.toBase58();
      if (seen.has(id)) continue;
      seen.add(id);
      addresses.push(address);
    } catch (_) { /* Ignore malformed directory hints. */ }
  }
  const rows = [];
  for (const address of addresses.slice(0, 20)) {
    try {
      const series = await fetchVerifiedSeries(connection, programId, address);
      if (series.mint.equals(mintKey)) rows.push({ address, ...series });
    } catch (_) { /* A stale or forged hint cannot appear in search results. */ }
  }
  return rows;
}
