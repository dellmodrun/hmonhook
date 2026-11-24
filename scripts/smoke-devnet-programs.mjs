// Read-only runtime smoke test. This does not send a transaction or spend the fee payer's SOL.
import assert from 'node:assert/strict';
import { Connection, PublicKey, TransactionMessage, TransactionInstruction, VersionedTransaction } from '@solana/web3.js';

const rpc = new Connection('https://api.devnet.solana.com', 'confirmed');
const genesis = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const simulatedFeePayer = new PublicKey('FEvT5nka9qBSXryv65P8ScjvGtfLUE7LgPu1rzuJ38h8');
const programs = [
  ['guard', 'DjEzdqVdMBJjvhtPSeFeP7bs6iNLe9zJyc86GzyT4ZQ7', 'NotEnoughAccountKeys'],
  ['options', 'D6iF15Dwpd9tK2nMEzUd5w5RNYQLnCWApUNoaGucaCni', 'InvalidInstructionData'],
];

async function rpcRead(read) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await read(); }
    catch (error) {
      if (attempt === 3) throw error;
      await new Promise((done) => setTimeout(done, attempt * 1000));
    }
  }
}

assert.equal(await rpcRead(() => rpc.getGenesisHash()), genesis, 'RPC must be Devnet');
for (const [kind, address, expectedError] of programs) {
  const programId = new PublicKey(address);
  const recentBlockhash = (await rpcRead(() => rpc.getLatestBlockhash())).blockhash;
  const message = new TransactionMessage({ payerKey: simulatedFeePayer, recentBlockhash,
    instructions: [new TransactionInstruction({ programId, keys: [], data: Buffer.alloc(0) })]
  }).compileToV0Message();
  const unsigned = new VersionedTransaction(message);
  // sigVerify:false allows an unsigned, read-only simulation using the funded Kora account.
  const { value } = await rpcRead(() => rpc.simulateTransaction(unsigned,
    { sigVerify: false, replaceRecentBlockhash: true }));
  assert.deepEqual(value.err, { InstructionError: [0, expectedError] });
  assert.ok(value.logs?.some((line) => line.startsWith(`Program ${address} invoke`)));
  assert.ok(value.unitsConsumed > 0);
  console.log(JSON.stringify({ kind, programId: address, error: expectedError,
    unitsConsumed: value.unitsConsumed, simulatedOnly: true }));
}
