import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { PumpSdk, PUMP_PROGRAM_ID, bondingCurvePda, isSolLikeQuoteMint } from '@pump-fun/pump-sdk';

const MAX_U64 = (1n << 64n) - 1n;

/** A fixed one-token strike from a single Pump curve snapshot, before trading fees. */
export function strikeFromPumpReserves({ virtualQuoteReserves, virtualTokenReserves, realTokenReserves, decimals, complete = false }) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 19) throw new RangeError('Invalid Mint decimals');
  const lotSize = 10n ** BigInt(decimals);
  if (lotSize > MAX_U64) throw new RangeError('One token does not fit in u64');
  const quote = BigInt(virtualQuoteReserves);
  const virtualTokens = BigInt(virtualTokenReserves);
  const realTokens = BigInt(realTokenReserves);
  if (complete || quote <= 0n || realTokens < lotSize || virtualTokens <= lotSize) {
    throw new Error('Pump curve cannot price one full token');
  }
  // Pump's constant-product exact-token-in quote: floor(base * virtual quote /
  // (virtual base - base)) + 1. This fixes a strike, not a fee-inclusive buy quote.
  const strikeLamports = lotSize * quote / (virtualTokens - lotSize) + 1n;
  if (strikeLamports > MAX_U64) throw new RangeError('Strike does not fit in u64');
  return { lotSize, strikeLamports, premiumLamports: strikeLamports / 10n + BigInt(strikeLamports % 10n !== 0n) };
}

/** Reads the Mint and its Pump curve together so the quoted reserves share one RPC slot. */
export async function fetchPumpStrikeSuggestion(connection, mintAddress) {
  const mint = new PublicKey(mintAddress);
  const curveAddress = bondingCurvePda(mint);
  const response = await connection.getMultipleAccountsInfoAndContext([mint, curveAddress], 'confirmed');
  const [mintInfo, curveInfo] = response.value;
  if (!mintInfo || !mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) || !mintInfo.data || mintInfo.data.length < 82 || mintInfo.data[45] !== 1) {
    throw new Error('Expected an initialized Token-2022 Mint');
  }
  if (!curveInfo || !curveInfo.owner.equals(PUMP_PROGRAM_ID)) throw new Error('Pump bonding curve is missing');
  const curve = new PumpSdk().decodeBondingCurve(curveInfo);
  if (!isSolLikeQuoteMint(curve.quoteMint)) throw new Error('Only SOL-quoted Pump curves can set a SOL strike');
  const quote = strikeFromPumpReserves({
    virtualQuoteReserves: curve.virtualQuoteReserves.toString(),
    virtualTokenReserves: curve.virtualTokenReserves.toString(),
    realTokenReserves: curve.realTokenReserves.toString(),
    decimals: mintInfo.data[44],
    complete: curve.complete,
  });
  return { mint: mint.toBase58(), curveAddress: curveAddress.toBase58(), slot: response.context.slot,
    virtualQuoteReserves: curve.virtualQuoteReserves.toString(),
    virtualTokenReserves: curve.virtualTokenReserves.toString(),
    realTokenReserves: curve.realTokenReserves.toString(),
    decimals: mintInfo.data[44], ...quote };
}
