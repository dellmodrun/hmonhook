import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { submitOptionsInstructions } from '../options-transaction-core.mjs';

const authority = Keypair.generate().publicKey;
const instruction = SystemProgram.transfer({ fromPubkey: authority, toPubkey: Keypair.generate().publicKey, lamports: 1 });
const blockhash = Keypair.generate().publicKey.toBase58();

test('failed option simulation stops before the wallet is asked to sign', async () => {
  let walletCalls = 0;
  const provider = { publicKey: authority, async signAndSendTransaction() { walletCalls++; throw new Error('must not sign'); } };
  const connection = { async getLatestBlockhash() { return { blockhash, lastValidBlockHeight: 42 }; },
    async simulateTransaction(tx) { assert.ok(tx instanceof Transaction); return { value: { err: { InstructionError: [0, { Custom: 123 }] } } }; } };
  await assert.rejects(submitOptionsInstructions({ connection, provider, authority, instructions: [instruction] }),
    /simulation failed/);
  assert.equal(walletCalls, 0);
});

test('successful option simulation precedes signing and confirmation', async () => {
  const order = [];
  const signature = '2'.repeat(64);
  const provider = { publicKey: authority,
    async signAndSendTransaction() { order.push('wallet'); return { signature }; } };
  const connection = {
    async getLatestBlockhash() { return { blockhash, lastValidBlockHeight: 42 }; },
    async simulateTransaction() { order.push('simulate'); return { value: { err: null } }; },
    async confirmTransaction() { order.push('confirm'); return { value: { err: null } }; },
  };
  const result = await submitOptionsInstructions({ connection, provider, authority, instructions: [instruction] });
  assert.deepEqual(order, ['simulate', 'wallet', 'confirm']);
  assert.equal(result.status, 'confirmed');
});
