import test from 'node:test';
import assert from 'node:assert/strict';
import { PUMP_PROGRAM_ID, PUMP_SDK } from '@pump-fun/pump-sdk';
import { Keypair } from '@solana/web3.js';

test('the installed Pump create_v2 route uses Token-2022 collateral-compatible Mints', async () => {
  const user = Keypair.generate().publicKey;
  const instruction = await PUMP_SDK.createV2Instruction({
    mint: Keypair.generate().publicKey,
    name: 'Compatibility test', symbol: 'TEST', uri: 'https://example.org/test.json',
    creator: user, user, mayhemMode: false, holderReward: false,
  });
  assert.ok(instruction.programId.equals(PUMP_PROGRAM_ID));
  assert.equal(instruction.keys.length, 16);
  assert.equal(instruction.keys[7].pubkey.toBase58(), 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
});
