import { Buffer } from 'buffer';
import { Connection, PublicKey } from '@solana/web3.js';
export { Connection } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAccount, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { PumpSdk, PUMP_PROGRAM_ID, bondingCurvePda, isSolLikeQuoteMint } from '@pump-fun/pump-sdk';
import { strikeFromPumpReserves } from './options-strike-core.mjs';
export { SOLANA_MAINNET_GENESIS_HASH } from './options-network-core.mjs';
import { verifyOptionsProgram } from './options-release-core.mjs';
import { submitOptionsInstructions } from './options-transaction-core.mjs';
export { submitOptionsInstructions } from './options-transaction-core.mjs';
import { openSeriesInstructions, buyOptionsInstruction, exerciseInstructions,
  claimDefaultInstructions, refundPremiumInstruction, triggerDefaultInstruction,
  reclaimInstructions, withdrawRegisteredTreasuryInstruction, fetchVerifiedSeries,
  derivePosition, fetchVerifiedPosition, listVerifiedSeriesByMint } from './options-core.mjs';

const MAX_U64 = (1n << 64n) - 1n;

function publicKey(value: unknown): PublicKey { return new PublicKey(String(value)); }
function positiveInteger(value: unknown, field: string): bigint {
  const text = String(value);
  if (!/^\d+$/.test(text)) throw new Error(`${field} must be a whole number.`);
  const number = BigInt(text);
  if (number <= 0n || number > MAX_U64) throw new Error(`${field} is out of range.`);
  return number;
}
function validMintExtensions(data: Buffer): boolean {
  if (data.length === 82) return true;
  if (data.length < 166 || data.subarray(82, 165).some((byte) => byte !== 0) || data[165] !== 1) return false;
  let offset = 166;
  while (offset < data.length) {
    if (data.subarray(offset).every((byte) => byte === 0)) return true;
    if (data.length - offset < 4) return false;
    const kind = data.readUInt16LE(offset);
    const length = data.readUInt16LE(offset + 2);
    if (kind < 18 || kind > 23 || !length || offset + 4 + length > data.length) return false;
    offset += 4 + length;
  }
  return true;
}
function randomNonce(): bigint {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).readBigUInt64LE();
}
function rpcConnection(endpoint: string): Connection {
  const parsed = new URL(endpoint);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1')) {
    throw new Error('Use an HTTPS RPC endpoint or a local validator.');
  }
  return new Connection(parsed.href, 'confirmed');
}
async function requireTreasuryAboveFloor(connection: Connection, terms: Awaited<ReturnType<typeof fetchVerifiedSeries>>, seriesKey: PublicKey) {
  let treasury;
  try { treasury = await getAccount(connection, terms.treasury, 'confirmed', TOKEN_2022_PROGRAM_ID); }
  catch (_) { throw new Error('The registered issuer treasury is missing or unreadable. Purchase is blocked.'); }
  if (!treasury.mint.equals(terms.mint) || !treasury.owner.equals(seriesKey) ||
      treasury.amount < terms.treasuryFloor) {
    throw new Error('The registered issuer treasury is below its commitment. Purchase is blocked.');
  }
}

export async function loadOptionsProgram(connection: Connection, config: { enabled: boolean; programId?: string;
  programSha256?: string; upgradeAuthority?: string | null }) {
  return verifyOptionsProgram(connection, config);
}

export async function listOptionSeriesForMint({ rpcEndpoint, programId, mint }:
  { rpcEndpoint: string; programId: string; mint: string }) {
  const connection = rpcConnection(rpcEndpoint);
  const rows = await listVerifiedSeriesByMint(connection, publicKey(programId), publicKey(mint));
  return rows.sort((a, b) => a.expirySlot === b.expirySlot ? 0 : a.expirySlot > b.expirySlot ? -1 : 1);
}

export async function previewIssuerSeries({ rpcEndpoint, programId, issuer, mint, percent, registeredTokens, saleWindowSlots,
  expiryWindowSlots }: { rpcEndpoint: string; programId: string; issuer: string; mint: string;
  percent: number; registeredTokens: string; saleWindowSlots: number; expiryWindowSlots: number }) {
  if (!Number.isInteger(percent) || percent < 2 || percent > 10) throw new Error('Lock 2% to 10% of the Mint supply.');
  if (!Number.isSafeInteger(saleWindowSlots) || saleWindowSlots < 1000 ||
      !Number.isSafeInteger(expiryWindowSlots) || expiryWindowSlots <= saleWindowSlots) {
    throw new Error('Choose a sale window of at least 1,000 slots and a later expiry.');
  }
  const connection = rpcConnection(rpcEndpoint);
  const mintKey = publicKey(mint);
  const issuerKey = publicKey(issuer);
  const curveKey = bondingCurvePda(mintKey);
  const response = await connection.getMultipleAccountsInfoAndContext([mintKey, curveKey], 'confirmed');
  const [mintInfo, curveInfo] = response.value;
  if (!mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID) || mintInfo.data.length < 82 ||
      mintInfo.data.readUInt32LE(0) !== 0 || mintInfo.data.readUInt32LE(46) !== 0 ||
      mintInfo.data[45] !== 1 || !validMintExtensions(mintInfo.data)) {
    throw new Error('Mint must be a supported Token-2022 coin with no mint or freeze authority.');
  }
  if (!curveInfo?.owner.equals(PUMP_PROGRAM_ID)) throw new Error('Pump curve is missing for this Mint.');
  const curve = new PumpSdk().decodeBondingCurve(curveInfo);
  if (!isSolLikeQuoteMint(curve.quoteMint)) throw new Error('This protection series requires a SOL-quoted Pump coin.');
  const strike = strikeFromPumpReserves({ virtualQuoteReserves: curve.virtualQuoteReserves.toString(),
    virtualTokenReserves: curve.virtualTokenReserves.toString(), realTokenReserves: curve.realTokenReserves.toString(),
    decimals: mintInfo.data[44], complete: curve.complete });
  const supply = mintInfo.data.readBigUInt64LE(36);
  const lots = (supply * BigInt(percent) + 100n * strike.lotSize - 1n) / (100n * strike.lotSize);
  const deposit = lots * strike.lotSize;
  if (deposit === 0n || deposit * 100n > supply * 10n) throw new Error('Whole-token lots cannot represent this lock percentage.');
  const sourceAddress = getAssociatedTokenAddressSync(mintKey, issuerKey, false, TOKEN_2022_PROGRAM_ID);
  const source = await getAccount(connection, sourceAddress, 'confirmed', TOKEN_2022_PROGRAM_ID);
  if (!source.owner.equals(issuerKey) || !source.mint.equals(mintKey) || source.isFrozen || source.delegate) {
    throw new Error('Issuer treasury is not an unrestricted token account for this Mint.');
  }
  const floor = positiveInteger(registeredTokens, 'Registered tokens') * strike.lotSize;
  if (floor > MAX_U64 || floor > source.amount - deposit) throw new Error('Issuer balance cannot cover both collateral and the registered allocation.');
  const nonce = randomNonce();
  const saleDeadlineSlot = BigInt(response.context.slot) + BigInt(saleWindowSlots);
  const expirySlot = BigInt(response.context.slot) + BigInt(expiryWindowSlots);
  const opened = openSeriesInstructions({ programId: publicKey(programId), issuer: issuerKey, mint: mintKey,
    source: sourceAddress, nonce, deposit, strikeLamports: strike.strikeLamports,
    saleDeadlineSlot, expirySlot, treasuryFloor: floor });
  return { connection, programId: publicKey(programId), issuer: issuerKey, mint: mintKey,
    source: sourceAddress, treasury: opened.series.treasury,
    nonce, series: opened.series.address, instructions: opened.instructions, supply, deposit,
    treasuryBefore: source.amount, treasuryFloor: floor, strikeLamports: strike.strikeLamports,
    premiumLamports: strike.premiumLamports, lotSize: strike.lotSize, totalLots: lots,
    snapshotSlot: response.context.slot, saleDeadlineSlot, expirySlot };
}

export async function submitIssuerSeries(prepared: Awaited<ReturnType<typeof previewIssuerSeries>>, provider: any) {
  const current = await prepared.connection.getMultipleAccountsInfoAndContext([
    prepared.mint, bondingCurvePda(prepared.mint), prepared.source,
  ], 'confirmed');
  const [mintInfo, curveInfo, treasuryInfo] = current.value;
  if (!mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID) || mintInfo.data.length < 82 ||
      mintInfo.data.readUInt32LE(0) !== 0 || mintInfo.data.readUInt32LE(46) !== 0 ||
      mintInfo.data[45] !== 1 || !validMintExtensions(mintInfo.data) ||
      mintInfo.data.readBigUInt64LE(36) !== prepared.supply ||
      !curveInfo?.owner.equals(PUMP_PROGRAM_ID) || !treasuryInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error('Mint, curve or issuer treasury changed. Review the lock again.');
  }
  const curve = new PumpSdk().decodeBondingCurve(curveInfo);
  if (!isSolLikeQuoteMint(curve.quoteMint)) throw new Error('Pump quote Mint changed. Review the lock again.');
  const strike = strikeFromPumpReserves({ virtualQuoteReserves: curve.virtualQuoteReserves.toString(),
    virtualTokenReserves: curve.virtualTokenReserves.toString(), realTokenReserves: curve.realTokenReserves.toString(),
    decimals: mintInfo.data[44], complete: curve.complete });
  if (strike.strikeLamports !== prepared.strikeLamports || strike.lotSize !== prepared.lotSize) {
    throw new Error('Pump price changed. Review the lock again.');
  }
  const source = await getAccount(prepared.connection, prepared.source, 'confirmed', TOKEN_2022_PROGRAM_ID);
  if (!source.owner.equals(prepared.issuer) || !source.mint.equals(prepared.mint) ||
      source.isFrozen || source.delegate || source.amount !== prepared.treasuryBefore) {
    throw new Error('Issuer treasury changed. Review the lock again.');
  }
  const result = await submitOptionsInstructions({ connection: prepared.connection, provider,
    authority: prepared.issuer, instructions: prepared.instructions });
  if (result.status === 'confirmed') await fetchVerifiedSeries(prepared.connection, prepared.programId, prepared.series);
  return { ...result, series: prepared.series.toBase58() };
}

export async function previewBuyerPosition({ rpcEndpoint, programId, series, buyer, lots }:
  { rpcEndpoint: string; programId: string; series: string; buyer: string; lots: string | number }) {
  const connection = rpcConnection(rpcEndpoint);
  const programKey = publicKey(programId);
  const seriesKey = publicKey(series);
  const buyerKey = publicKey(buyer);
  const terms = await fetchVerifiedSeries(connection, programKey, seriesKey);
  const count = positiveInteger(lots, 'Lots');
  const slot = await connection.getSlot('confirmed');
  if (terms.status !== 0 || BigInt(slot) > terms.saleDeadlineSlot ||
      count > terms.totalLots - terms.soldLots) throw new Error('The requested option lots are not on sale.');
  await requireTreasuryAboveFloor(connection, terms, seriesKey);
  return { connection, programId: programKey, series: seriesKey, buyer: buyerKey, terms,
    lots: count, premiumLamports: terms.premiumLamports * count,
    position: derivePosition(programKey, seriesKey, buyerKey) };
}

export async function inspectOptionSeries({ rpcEndpoint, programId, series, buyer }:
  { rpcEndpoint: string; programId: string; series: string; buyer?: string }) {
  const connection = rpcConnection(rpcEndpoint);
  const programKey = publicKey(programId);
  const seriesKey = publicKey(series);
  const terms = await fetchVerifiedSeries(connection, programKey, seriesKey);
  const slot = await connection.getSlot('confirmed');
  const vault = await getAccount(connection, terms.vault, 'confirmed', TOKEN_2022_PROGRAM_ID);
  if (!vault.mint.equals(terms.mint) || !vault.owner.equals(seriesKey)) {
    throw new Error('Collateral vault does not match the verified option series.');
  }
  let treasuryAmount = 0n;
  try {
    const treasury = await getAccount(connection, terms.treasury, 'confirmed', TOKEN_2022_PROGRAM_ID);
    if (treasury.mint.equals(terms.mint) && treasury.owner.equals(seriesKey)) treasuryAmount = treasury.amount;
  } catch (_) { /* A closed treasury counts as breached. */ }
  const position = buyer ? await fetchVerifiedPosition(connection, programKey, seriesKey, publicKey(buyer)) : null;
  return { terms, slot, vaultAmount: vault.amount, treasuryAmount, position,
    registeredTreasuryBreached: treasuryAmount < terms.treasuryFloor };
}

export async function submitBuyerPosition(prepared: Awaited<ReturnType<typeof previewBuyerPosition>>, provider: any) {
  const current = await fetchVerifiedSeries(prepared.connection, prepared.programId, prepared.series);
  const slot = await prepared.connection.getSlot('confirmed');
  if (current.status !== 0 || BigInt(slot) > current.saleDeadlineSlot ||
      current.soldLots !== prepared.terms.soldLots || current.premiumLamports !== prepared.terms.premiumLamports ||
      prepared.lots > current.totalLots - current.soldLots) {
    throw new Error('Option availability changed. Review a fresh quote.');
  }
  await requireTreasuryAboveFloor(prepared.connection, current, prepared.series);
  const instruction = buyOptionsInstruction({ programId: prepared.programId, series: prepared.series,
    buyer: prepared.buyer, lots: prepared.lots });
  const result = await submitOptionsInstructions({ connection: prepared.connection, provider,
    authority: prepared.buyer, instructions: [instruction] });
  return { ...result, position: prepared.position.toBase58(), premiumLamports: prepared.premiumLamports.toString() };
}

export async function submitPositionAction({ rpcEndpoint, programId, series, buyer, provider, action, lots }:
  { rpcEndpoint: string; programId: string; series: string; buyer: string; provider: any;
    action: 'exercise' | 'claim' | 'refund'; lots?: string | number }) {
  const connection = rpcConnection(rpcEndpoint);
  const programKey = publicKey(programId);
  const seriesKey = publicKey(series);
  const buyerKey = publicKey(buyer);
  const terms = await fetchVerifiedSeries(connection, programKey, seriesKey);
  let instructions;
  if (action === 'refund') instructions = [refundPremiumInstruction({ programId: programKey, series: seriesKey, buyer: buyerKey })];
  else if (action === 'exercise' || action === 'claim') {
    const count = positiveInteger(lots, 'Lots');
    const args = { programId: programKey, series: seriesKey, mint: terms.mint,
      vault: terms.vault, issuer: terms.issuer, buyer: buyerKey, lots: count };
    instructions = action === 'exercise' ? exerciseInstructions(args).instructions : claimDefaultInstructions(args).instructions;
  } else throw new Error('Unsupported option position action.');
  return submitOptionsInstructions({ connection, provider, authority: buyerKey, instructions });
}

export async function submitSeriesAction({ rpcEndpoint, programId, series, signer, provider, action }:
  { rpcEndpoint: string; programId: string; series: string; signer: string; provider: any;
    action: 'register-default' | 'reclaim' | 'withdraw-registered' }) {
  const connection = rpcConnection(rpcEndpoint);
  const programKey = publicKey(programId);
  const seriesKey = publicKey(series);
  const signerKey = publicKey(signer);
  const terms = await fetchVerifiedSeries(connection, programKey, seriesKey);
  let instructions;
  if (action === 'register-default') {
    if (terms.status !== 0) throw new Error('Only an active series can register a treasury breach.');
    instructions = [triggerDefaultInstruction({ programId: programKey, series: seriesKey })];
  } else if (action === 'withdraw-registered') {
    if (!terms.issuer.equals(signerKey)) throw new Error('Only the issuer can withdraw the registered allocation.');
    const destination = getAssociatedTokenAddressSync(terms.mint, signerKey, false, TOKEN_2022_PROGRAM_ID);
    instructions = [createAssociatedTokenAccountIdempotentInstruction(signerKey, destination, signerKey, terms.mint, TOKEN_2022_PROGRAM_ID),
      withdrawRegisteredTreasuryInstruction({ programId: programKey, issuer: signerKey, series: seriesKey,
        mint: terms.mint, destination })];
  } else if (action === 'reclaim') {
    if (!terms.issuer.equals(signerKey)) throw new Error('Only the issuer can reclaim eligible collateral.');
    instructions = reclaimInstructions({ programId: programKey, issuer: signerKey, series: seriesKey,
      mint: terms.mint, vault: terms.vault }).instructions;
  } else throw new Error('Unsupported option series action.');
  return submitOptionsInstructions({ connection, provider, authority: signerKey, instructions });
}
