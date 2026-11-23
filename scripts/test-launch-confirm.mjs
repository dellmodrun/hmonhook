import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmPumpLaunch } from '../launch-confirm.mjs';

const latest = { blockhash: 'blockhash', lastValidBlockHeight: 100 };
const signature = 'signed-transaction';
const mint = 'new-mint';

test('accepts a confirmed launch', async () => {
  const connection = { confirmTransaction: async () => ({ value: { err: null } }) };
  await confirmPumpLaunch(connection, signature, latest, mint);
});

test('recovers a confirmed signature after an RPC timeout', async () => {
  const connection = {
    confirmTransaction: async () => { throw new Error('timeout'); },
    getSignatureStatus: async () => ({ value: { confirmationStatus: 'confirmed', err: null } }),
  };
  await confirmPumpLaunch(connection, signature, latest, mint);
});

test('reports a pending signature and Mint rather than calling it a failed launch', async () => {
  const connection = {
    confirmTransaction: async () => { throw new Error('timeout'); },
    getSignatureStatus: async () => ({ value: null }),
  };
  await assert.rejects(confirmPumpLaunch(connection, signature, latest, mint), /Check signature signed-transaction and Mint new-mint before retrying/);
});

test('rejects a confirmed on-chain transaction failure', async () => {
  const connection = { confirmTransaction: async () => ({ value: { err: { InstructionError: [0, 'Custom'] } } }) };
  await assert.rejects(confirmPumpLaunch(connection, signature, latest, mint), /Transaction failed/);
});
