// Exercise the unsigned browser preflight against a real local-validator RPC.
import assert from 'node:assert/strict';
import { Connection, Keypair, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { submitOptionsInstructions } from '../options-transaction-core.mjs';

const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
const payer = Keypair.generate();
const recipient = Keypair.generate().publicKey;
const airdrop = await connection.requestAirdrop(payer.publicKey, 2_000_000_000);
await connection.confirmTransaction(airdrop, 'confirmed');
await connection.confirmTransaction(await connection.requestAirdrop(recipient, 1_000_000), 'confirmed');
const recipientBefore = await connection.getBalance(recipient, 'confirmed');
let walletPrompts = 0;
const provider = { publicKey: payer.publicKey, async signAndSendTransaction(transaction) {
  walletPrompts++;
  const signature = await sendAndConfirmTransaction(connection, transaction, [payer], { commitment: 'confirmed' });
  return { signature };
} };
const good = SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: recipient, lamports: 1_000 });
const completed = await submitOptionsInstructions({ connection, provider, authority: payer.publicKey, instructions: [good] });
assert.equal(completed.status, 'confirmed');
assert.equal(await connection.getBalance(recipient, 'confirmed'), recipientBefore + 1_000);
assert.equal(walletPrompts, 1);

const excessive = SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: recipient, lamports: 3_000_000_000 });
await assert.rejects(submitOptionsInstructions({ connection, provider, authority: payer.publicKey,
  instructions: [excessive] }), /simulation failed/);
assert.equal(walletPrompts, 1, 'a rejected simulation must not ask the wallet to sign');
assert.equal(await connection.getBalance(recipient, 'confirmed'), recipientBefore + 1_000);
console.log(JSON.stringify({ localValidator: true, acceptedSignature: completed.signature,
  failedSimulationBlockedWallet: true }));
