import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { Keypair, PublicKey } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  deriveSeries, derivePosition, openSeriesInstructions, buyOptionsInstruction,
  exerciseInstructions, claimDefaultInstructions, triggerDefaultInstruction,
  withdrawRegisteredTreasuryInstruction,
  reclaimInstructions, refundPremiumInstruction, decodeSeries,
  fetchVerifiedSeries,
  listVerifiedSeriesByMint,
  deriveBuybackVault, deriveBuybackAuthority, buybackVaultPrepInstructions, buildPumpBuybackRoute, pumpBuybackInstruction,
  buildPumpSwapBuybackRoute, pumpSwapBuybackInstruction,
  reclaimBuybackRentInstruction,
} from '../options-client.mjs';
const { PUMP_AMM_PROGRAM_ID, canonicalPumpPoolPda, lpMintPda } = createRequire(import.meta.url)('@pump-fun/pump-swap-sdk');

const programId = Keypair.generate().publicKey;
const issuer = Keypair.generate().publicKey;
const buyer = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const source = Keypair.generate().publicKey;
const nonce = 7n;
const { address: series, vault, treasury } = deriveSeries(programId, mint, issuer, nonce);

test('series and position PDAs bind mint, issuer and buyer', () => {
  assert.notEqual(series.toBase58(), deriveSeries(programId, mint, buyer, nonce).address.toBase58());
  assert.notEqual(derivePosition(programId, series, buyer).toBase58(), derivePosition(programId, series, issuer).toBase58());
});

test('opening derives a separate program-controlled registered treasury', () => {
  const opened = openSeriesInstructions({
    programId, issuer, mint, source,
    nonce, deposit: 20n, strikeLamports: 100n, saleDeadlineSlot: 200n,
    expirySlot: 300n, treasuryFloor: 40n,
  });
  assert.ok(!opened.series.treasury.equals(source));
  assert.ok(!opened.series.treasury.equals(opened.series.vault));
  assert.equal(opened.instructions[1].keys[4].pubkey.toBase58(), treasury.toBase58());
});

test('Pump buyback route targets a separate program-owned vault', async () => {
  const buyback = deriveBuybackVault(programId, series, mint);
  assert.notEqual(buyback.baseVault.toBase58(), vault.toBase58());
  const prep = buybackVaultPrepInstructions({ programId, series, mint, payer: issuer });
  assert.equal(prep.instructions.length, 1);
  assert.equal(prep.instructions[0].keys[1].pubkey.toBase58(), buyback.baseVault.toBase58());
  const { route } = await buildPumpBuybackRoute({
    programId, series, mint, spendableQuoteIn: 1_000_000n, minTokensOut: 1_000n,
  });
  assert.equal(route.keys[8].pubkey.toBase58(), buyback.authority.toBase58());
  assert.equal(route.keys[9].pubkey.toBase58(), buyback.baseVault.toBase58());
  assert.equal(route.keys[10].pubkey.toBase58(), buyback.quoteVault.toBase58());
  assert.equal(route.keys[12].pubkey.toBase58(), '8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt');
  assert.equal(route.keys[13].pubkey.toBase58(), '5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD');
  await assert.rejects(() => buildPumpBuybackRoute({
    programId, series, mint, spendableQuoteIn: 0n, minTokensOut: 1n,
  }), /positive/);
});

test('Pump buyback uses a keeper rent allowance while the PDA signs only inside the options program', async () => {
  const built = await pumpBuybackInstruction({ programId, series, mint, keeper: issuer,
    spendableQuoteIn: 1_000_000n, minTokensOut: 1_000_000n,
    keeperTopupLamports: 2_000_000n, strikeLamports: 1_000_000n, lotSize: 1_000_000n });
  assert.equal(built.instruction.data[0], 7);
  assert.equal(built.instruction.keys.length, 19);
  assert.equal(built.instruction.keys[10].pubkey.toBase58(), built.vault.authority.toBase58());
  assert.equal(built.instruction.keys[10].isSigner, false);
  assert.equal(built.instruction.keys[0].isSigner, true);
  assert.equal(built.instruction.keys[1].isWritable, true);
  assert.equal(built.instruction.data.readBigUInt64LE(17), 2_000_000n);
  await assert.rejects(() => pumpBuybackInstruction({ programId, series, mint, keeper: issuer,
    spendableQuoteIn: 1_000_000n, minTokensOut: 1n,
    keeperTopupLamports: 2_000_000n, strikeLamports: 1_000_000n, lotSize: 1_000_000n }), /Minimum output/);
});

test('PumpSwap route builder accepts a canonical decoded pool and emits a signed outer instruction', async () => {
  const pool = canonicalPumpPoolPda(mint);
  const pump = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
  const creator = PublicKey.findProgramAddressSync([Buffer.from('pool-authority'), mint.toBuffer()], pump)[0];
  const base = getAssociatedTokenAddressSync(mint, pool, true, TOKEN_2022_PROGRAM_ID);
  const quote = getAssociatedTokenAddressSync(NATIVE_MINT, pool, true, TOKEN_PROGRAM_ID);
  const data = Buffer.alloc(270);
  Buffer.from([241, 154, 109, 4, 17, 177, 109, 188]).copy(data, 0);
  creator.toBuffer().copy(data, 11);
  mint.toBuffer().copy(data, 43);
  NATIVE_MINT.toBuffer().copy(data, 75);
  lpMintPda(pool).toBuffer().copy(data, 107);
  base.toBuffer().copy(data, 139);
  quote.toBuffer().copy(data, 171);
  data.writeBigUInt64LE(1n, 203);
  const connection = { getAccountInfo: async () => ({ owner: PUMP_AMM_PROGRAM_ID, data }) };
  const route = await buildPumpSwapBuybackRoute({ connection, programId, series, mint,
    spendableQuoteIn: 2_000n, minTokensOut: 1_000_000n });
  assert.equal(route.route.programId.toBase58(), PUMP_AMM_PROGRAM_ID.toBase58());
  assert.equal(route.route.keys[0].pubkey.toBase58(), pool.toBase58());
  const built = await pumpSwapBuybackInstruction({ connection, programId, series, mint, keeper: issuer,
    spendableQuoteIn: 2_000n, minTokensOut: 1_000_000n, keeperTopupLamports: 2_000_000n,
    strikeLamports: 1_000n, lotSize: 1_000_000n });
  assert.equal(built.instruction.data[0], 9);
  assert.equal(built.instruction.keys[0].pubkey.toBase58(), issuer.toBase58());
});

test('all option actions target the chosen new program with exact account order', () => {
  const open = openSeriesInstructions({ programId, issuer, mint, source, treasury, nonce, deposit: 20n, strikeLamports: 100n, saleDeadlineSlot: 200n, expirySlot: 300n, treasuryFloor: 40n });
  assert.equal(open.series.address.toBase58(), series.toBase58());
  assert.equal(open.instructions[1].data[0], 0);
  assert.equal(open.instructions[1].keys[3].pubkey.toBase58(), vault.toBase58());
  assert.equal(open.instructions[1].keys[5].pubkey.toBase58(), series.toBase58());
  assert.equal(open.instructions[1].keys[9].pubkey.toBase58(),
    PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), mint.toBuffer()], new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'))[0].toBase58());
  const buy = buyOptionsInstruction({ programId, series, buyer, treasury, lots: 2n });
  assert.equal(buy.data[0], 1);
  assert.equal(buy.keys[2].pubkey.toBase58(), derivePosition(programId, series, buyer).toBase58());
  assert.equal(buy.keys[3].pubkey.toBase58(), treasury.toBase58());
  assert.equal(buy.keys[4].pubkey.toBase58(), deriveBuybackAuthority(programId, series).toBase58());
  for (const [op, action] of [
    [2, exerciseInstructions({ programId, series, mint, vault, issuer, buyer, lots: 1n })],
    [4, claimDefaultInstructions({ programId, series, mint, vault, issuer, buyer, lots: 1n })],
  ]) {
    assert.equal(action.instructions[1].data[0], op);
    assert.equal(action.instructions[1].keys[5].pubkey.toBase58(), vault.toBase58());
  }
  assert.equal(triggerDefaultInstruction({ programId, series }).data[0], 3);
  const withdraw = withdrawRegisteredTreasuryInstruction({ programId, issuer, series, mint, destination: source });
  assert.equal(withdraw.data[0], 11);
  assert.equal(withdraw.keys[3].pubkey.toBase58(), treasury.toBase58());
  assert.equal(reclaimInstructions({ programId, issuer, series, mint, vault }).instructions[1].data[0], 5);
  const refund = refundPremiumInstruction({ programId, series, buyer });
  assert.equal(refund.data[0], 6);
  assert.equal(refund.keys[2].pubkey.toBase58(), derivePosition(programId, series, buyer).toBase58());
  assert.equal(refund.keys[3].pubkey.toBase58(), deriveBuybackAuthority(programId, series).toBase58());
  assert.equal(reclaimBuybackRentInstruction({ programId, series, issuer }).data[0], 8);
});

test('series decoder rejects unrelated bytes and preserves base-unit terms', () => {
  const bytes = Buffer.alloc(266);
  bytes.write('HMONOPT3', 0);
  bytes[8] = 1;
  bytes[9] = 255;
  bytes.writeBigUInt64LE(7n, 10);
  for (let index = 0; index < 4; index++) {
    bytes.set([issuer, mint, vault, treasury][index].toBuffer(), 18 + index * 32);
  }
  bytes.writeBigUInt64LE(100n, 146);
  bytes.writeBigUInt64LE(25n, 234);
  bytes.writeBigUInt64LE(5n, 242);
  const decoded = decodeSeries(bytes);
  assert.equal(decoded.status, 1);
  assert.equal(decoded.nonce, 7n);
  assert.equal(decoded.issuer.toBase58(), issuer.toBase58());
  assert.equal(decoded.treasuryFloor, 100n);
  assert.equal(decoded.premiumLamports, 25n);
  assert.equal(decoded.premiumSpentLamports, 5n);
  assert.throws(() => decodeSeries(Buffer.alloc(266)), /Invalid h\/monhook/);
  assert.throws(() => decodeSeries(Buffer.alloc(265)), /Invalid h\/monhook/);
  assert.ok(decoded.mint instanceof PublicKey);
});

test('remote series must be owned by the expected program and match its PDA', async () => {
  const bytes = Buffer.alloc(266);
  bytes.write('HMONOPT3', 0);
  bytes[9] = deriveSeries(programId, mint, issuer, nonce).bump;
  bytes.writeBigUInt64LE(nonce, 10);
  for (let index = 0; index < 4; index++) bytes.set([issuer, mint, vault, treasury][index].toBuffer(), 18 + index * 32);
  const connection = { getAccountInfo: async () => ({ owner: programId, data: bytes }) };
  assert.equal((await fetchVerifiedSeries(connection, programId, series)).mint.toBase58(), mint.toBase58());
  await assert.rejects(() => fetchVerifiedSeries({ getAccountInfo: async () => ({ owner: buyer, data: bytes }) }, programId, series), /not owned/);
  await assert.rejects(() => fetchVerifiedSeries(connection, programId, buyer), /does not match/);
  const listed = await listVerifiedSeriesByMint({ getProgramAccounts: async (_, options) => {
    assert.deepEqual(options.filters, [{ dataSize: 266 }, { memcmp: { offset: 50, bytes: mint.toBase58() } }]);
    return [{ pubkey: series, account: { owner: programId, data: bytes } }];
  } }, programId, mint);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].address.toBase58(), series.toBase58());
});
