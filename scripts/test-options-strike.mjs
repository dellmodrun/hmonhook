import assert from 'node:assert/strict';
import test from 'node:test';
import { strikeFromPumpReserves } from '../options-strike.mjs';

test('one-token strike follows Pump exact-token curve math with integer rounding', () => {
  const quote = strikeFromPumpReserves({
    virtualQuoteReserves: 30_000_000_000n,
    virtualTokenReserves: 1_073_000_000_000_000n,
    realTokenReserves: 793_000_000_000_000n,
    decimals: 6,
  });
  const expected = 1_000_000n * 30_000_000_000n / (1_073_000_000_000_000n - 1_000_000n) + 1n;
  assert.equal(quote.strikeLamports, expected);
  assert.equal(quote.premiumLamports, expected / 10n + BigInt(expected % 10n !== 0n));
});

test('completed or depleted curves cannot suggest a payable strike', () => {
  const curve = { virtualQuoteReserves: 30n, virtualTokenReserves: 100n, realTokenReserves: 10n, decimals: 1 };
  assert.throws(() => strikeFromPumpReserves({ ...curve, complete: true }), /cannot price/);
  assert.throws(() => strikeFromPumpReserves({ ...curve, realTokenReserves: 9n }), /cannot price/);
  assert.throws(() => strikeFromPumpReserves({ ...curve, virtualTokenReserves: 10n }), /cannot price/);
});
