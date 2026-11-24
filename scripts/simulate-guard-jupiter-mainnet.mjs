// Live mainnet read-only smoke test of the browser's Jupiter -> h/monhook Guard path.
// It never signs or sends a transaction and needs no private key.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { Connection } from '@solana/web3.js';

const root = resolve(import.meta.dirname, '..');
const modulePath = resolve(root, '.local-deploy', 'intent-client-node.cjs');
await build({ entryPoints: [resolve(root, 'intent-client.ts')], bundle: true,
  platform: 'node', format: 'cjs', outfile: modulePath });
const { submitProtectedSwap } = createRequire(import.meta.url)(modulePath);
const rpc = process.env.HMONHOOK_MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(rpc, 'confirmed');
const slot = await connection.getSlot('confirmed');
let transaction;
try {
  await submitProtectedSwap({
    provider: { signAndSendTransaction: async (tx) => { transaction = tx; throw new Error('SIMULATION_ONLY'); } },
    authority: 'DyjJ2cxfL3oYCnazLHB7zpe4sd4mSnQuCbqV5sDGrgmG',
    inputMint: 'So11111111111111111111111111111111111111112',
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    amount: '100000000', minimumOutput: '1', slippageBps: '100',
    expiresAtSlot: String(slot + 500), rpcEndpoint: rpc,
  });
} catch (error) {
  if (error.message !== 'SIMULATION_ONLY') throw error;
}
assert.ok(transaction, 'the browser path did not assemble a transaction');
const guardAddress = 'Be7RvxKNFa35ER8DSmPoBq6AssMMoJsMU4fBso1E2ELQ';
assert.ok(transaction.message.staticAccountKeys.some((key) => key.toBase58() === guardAddress),
  'transaction does not invoke the deployed h/monhook Guard');
const result = await connection.simulateTransaction(transaction, { sigVerify: false, replaceRecentBlockhash: true });
assert.equal(result.value.err, null, `mainnet simulation failed: ${JSON.stringify(result.value.err)}`);
assert.ok(result.value.logs?.some((line) => line.includes('HMON_RECEIPT')),
  'the h/monhook Guard did not report a settlement receipt');
console.log(JSON.stringify({ readOnly: true, signed: false, sent: false,
  programId: guardAddress, serializedBytes: transaction.serialize().length,
  computeUnits: result.value.unitsConsumed,
  receipt: result.value.logs.find((line) => line.includes('HMON_RECEIPT')) }, null, 2));
