import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  deriveSeries, derivePosition, openSeriesInstructions, buyOptionsInstruction,
  exerciseInstructions, claimDefaultInstructions, triggerDefaultInstruction,
  reclaimInstructions, decodeSeries,
  fetchVerifiedSeries,
} from '../options-client.mjs';

const programId = Keypair.generate().publicKey;
const issuer = Keypair.generate().publicKey;
const buyer = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const source = Keypair.generate().publicKey;
const treasury = Keypair.generate().publicKey;
const nonce = 7n;
const { address: series, vault } = deriveSeries(programId, mint, issuer, nonce);

test('series and position PDAs bind mint, issuer and buyer', () => {
  assert.notEqual(series.toBase58(), deriveSeries(programId, mint, buyer, nonce).address.toBase58());
  assert.notEqual(derivePosition(programId, series, buyer).toBase58(), derivePosition(programId, series, issuer).toBase58());
});

test('all option actions target the chosen new program with exact account order', () => {
  const open = openSeriesInstructions({ programId, issuer, mint, source, treasury, nonce, deposit: 20n, strikeLamports: 100n, saleDeadlineSlot: 200n, expirySlot: 300n, treasuryFloor: 40n });
  assert.equal(open.series.address.toBase58(), series.toBase58());
  assert.equal(open.instructions[1].data[0], 0);
  assert.equal(open.instructions[1].keys[3].pubkey.toBase58(), vault.toBase58());
  assert.equal(open.instructions[1].keys[5].pubkey.toBase58(), series.toBase58());
  const buy = buyOptionsInstruction({ programId, series, buyer, lots: 2n });
  assert.equal(buy.data[0], 1);
  assert.equal(buy.keys[2].pubkey.toBase58(), derivePosition(programId, series, buyer).toBase58());
  for (const [op, action] of [
    [2, exerciseInstructions({ programId, series, mint, vault, issuer, buyer, lots: 1n })],
    [4, claimDefaultInstructions({ programId, series, mint, vault, issuer, buyer, lots: 1n })],
  ]) {
    assert.equal(action.instructions[1].data[0], op);
    assert.equal(action.instructions[1].keys[5].pubkey.toBase58(), vault.toBase58());
  }
  assert.equal(triggerDefaultInstruction({ programId, series, treasury }).data[0], 3);
  assert.equal(reclaimInstructions({ programId, issuer, series, mint, vault }).instructions[1].data[0], 5);
});

test('series decoder rejects unrelated bytes and preserves base-unit terms', () => {
  const bytes = Buffer.alloc(242);
  bytes.write('HMONOPT1', 0);
  bytes[8] = 1;
  bytes[9] = 255;
  bytes.writeBigUInt64LE(7n, 10);
  for (let index = 0; index < 4; index++) {
    bytes.set([issuer, mint, vault, treasury][index].toBuffer(), 18 + index * 32);
  }
  bytes.writeBigUInt64LE(100n, 146);
  bytes.writeBigUInt64LE(25n, 234);
  const decoded = decodeSeries(bytes);
  assert.equal(decoded.status, 1);
  assert.equal(decoded.nonce, 7n);
  assert.equal(decoded.issuer.toBase58(), issuer.toBase58());
  assert.equal(decoded.treasuryFloor, 100n);
  assert.equal(decoded.premiumLamports, 25n);
  assert.throws(() => decodeSeries(Buffer.alloc(242)), /Invalid h\/monhook/);
  assert.throws(() => decodeSeries(Buffer.alloc(241)), /Invalid h\/monhook/);
  assert.ok(decoded.mint instanceof PublicKey);
});

test('remote series must be owned by the expected program and match its PDA', async () => {
  const bytes = Buffer.alloc(242);
  bytes.write('HMONOPT1', 0);
  bytes[9] = deriveSeries(programId, mint, issuer, nonce).bump;
  bytes.writeBigUInt64LE(nonce, 10);
  for (let index = 0; index < 4; index++) bytes.set([issuer, mint, vault, treasury][index].toBuffer(), 18 + index * 32);
  const connection = { getAccountInfo: async () => ({ owner: programId, data: bytes }) };
  assert.equal((await fetchVerifiedSeries(connection, programId, series)).mint.toBase58(), mint.toBase58());
  await assert.rejects(() => fetchVerifiedSeries({ getAccountInfo: async () => ({ owner: buyer, data: bytes }) }, programId, series), /not owned/);
  await assert.rejects(() => fetchVerifiedSeries(connection, programId, buyer), /does not match/);
});
