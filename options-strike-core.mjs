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
  const strikeLamports = lotSize * quote / (virtualTokens - lotSize) + 1n;
  if (strikeLamports > MAX_U64) throw new RangeError('Strike does not fit in u64');
  return { lotSize, strikeLamports, premiumLamports: strikeLamports / 10n + BigInt(strikeLamports % 10n !== 0n) };
}
