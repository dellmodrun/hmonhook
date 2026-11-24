import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { PUMP_PROGRAM_ID, PUMP_SDK } = createRequire(import.meta.url)('@pump-fun/pump-sdk');
import { Keypair } from '@solana/web3.js';
import { assertPumpCreateV2Route } from '../pump-launch-route.mjs';

test('the installed Pump create_v2 route uses Token-2022 collateral-compatible Mints', async () => {
  const user = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const instruction = await PUMP_SDK.createV2Instruction({
    mint,
    name: 'Compatibility test', symbol: 'TEST', uri: 'https://example.org/test.json',
    creator: user, user, mayhemMode: false, holderReward: false,
  });
  const expected = { mint, user, name: 'Compatibility test', symbol: 'TEST', uri: 'https://example.org/test.json' };
  assertPumpCreateV2Route(instruction, expected);
  assert.throws(() => assertPumpCreateV2Route(instruction, { ...expected, user: Keypair.generate().publicKey }), /Safety check failed/);
  assert.throws(() => assertPumpCreateV2Route(instruction, { ...expected, uri: 'https://example.org/other.json' }), /metadata changed/);
  const redirected = { ...instruction, keys: instruction.keys.map((key) => ({ ...key })) };
  redirected.keys[5].pubkey = Keypair.generate().publicKey;
  assert.throws(() => assertPumpCreateV2Route(redirected, expected), /accounts changed/);
  assert.throws(() => assertPumpCreateV2Route({ ...instruction, programId: Keypair.generate().publicKey }, expected), /accounts changed/);
  const altered = { ...instruction, data: Buffer.from(instruction.data) };
  altered.data[0] ^= 1;
  assert.throws(() => assertPumpCreateV2Route(altered, expected), /not the expected Pump/);
  const enabledOptionalFlag = { ...instruction, data: Buffer.from(instruction.data) };
  enabledOptionalFlag.data[enabledOptionalFlag.data.length - 1] = 1;
  assert.throws(() => assertPumpCreateV2Route(enabledOptionalFlag, expected), /launch settings changed/);
});
