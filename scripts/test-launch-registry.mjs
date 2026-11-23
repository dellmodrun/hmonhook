import assert from 'node:assert/strict';
import test from 'node:test';
import bs58 from 'bs58';
import { PUMP_SDK, PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { Keypair } from '@solana/web3.js';
import { verifiedLaunch } from '../supabase/functions/launch-registry/verify-launch.mjs';

const creator = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const instruction = await PUMP_SDK.createV2Instruction({
  mint, name: 'Registry Test', symbol: 'REG', uri: 'https://example.com/metadata.json',
  creator, user: creator, mayhemMode: false, holderReward: false,
});
const keys = [...new Set([creator.toBase58(), ...instruction.keys.map(key => key.pubkey.toBase58()), PUMP_PROGRAM_ID.toBase58()])];
const signature = bs58.encode(Keypair.generate().secretKey);
const transaction = {
  meta: { err: null },
  transaction: {
    signatures: [signature],
    message: {
      accountKeys: keys,
      instructions: [{
        programIdIndex: keys.indexOf(PUMP_PROGRAM_ID.toBase58()),
        accounts: instruction.keys.map(key => keys.indexOf(key.pubkey.toBase58())),
        data: bs58.encode(instruction.data),
      }],
    },
  },
};

test('accepts a confirmed Pump create_v2 with matching Mint and payer', () => {
  const launch = verifiedLaunch(transaction, mint.toBase58(), creator.toBase58());
  assert.equal(launch?.name, 'Registry Test');
  assert.equal(launch?.symbol, 'REG');
  assert.equal(launch?.metadata_uri, 'https://example.com/metadata.json');
});

test('rejects another Mint, payer or failed transaction', () => {
  assert.equal(verifiedLaunch(transaction, Keypair.generate().publicKey.toBase58(), creator.toBase58()), null);
  assert.equal(verifiedLaunch(transaction, mint.toBase58(), Keypair.generate().publicKey.toBase58()), null);
  assert.equal(verifiedLaunch({ ...transaction, meta: { err: { InstructionError: [0, 'Custom'] } } }, mint.toBase58(), creator.toBase58()), null);
});

test('rejects a different Pump instruction discriminator', () => {
  const tampered = structuredClone(transaction);
  const data = bs58.decode(tampered.transaction.message.instructions[0].data);
  data[0] ^= 255;
  tampered.transaction.message.instructions[0].data = bs58.encode(data);
  assert.equal(verifiedLaunch(tampered, mint.toBase58(), creator.toBase58()), null);
});

test('rejects malformed create_v2 data without accepting the launch', () => {
  const tampered = structuredClone(transaction);
  tampered.transaction.message.instructions[0].data = bs58.encode(Uint8Array.from([214, 144, 76, 236, 95, 139, 49, 180]));
  assert.equal(verifiedLaunch(tampered, mint.toBase58(), creator.toBase58()), null);
});
