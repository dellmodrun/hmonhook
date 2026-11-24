import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Keypair, PublicKey } from '@solana/web3.js';
import { verifyOptionsProgram } from '../options-release-core.mjs';

const loader = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

function fixture() {
  const programId = Keypair.generate().publicKey;
  const programDataId = Keypair.generate().publicKey;
  const authority = Keypair.generate().publicKey;
  const binary = Buffer.from('reviewed h/monhook options binary fixture');
  const programBytes = Buffer.alloc(36);
  programBytes.writeUInt32LE(2, 0);
  programDataId.toBuffer().copy(programBytes, 4);
  const programDataBytes = Buffer.alloc(45 + binary.length);
  programDataBytes.writeUInt32LE(3, 0);
  programDataBytes[12] = 1;
  authority.toBuffer().copy(programDataBytes, 13);
  binary.copy(programDataBytes, 45);
  const accounts = new Map([
    [programId.toBase58(), { executable: true, owner: loader, data: programBytes }],
    [programDataId.toBase58(), { executable: false, owner: loader, data: programDataBytes }],
  ]);
  const connection = { async getAccountInfo(key) { return accounts.get(key.toBase58()) || null; } };
  const config = { enabled: true, programId: programId.toBase58(),
    programSha256: createHash('sha256').update(binary).digest('hex'),
    upgradeAuthority: authority.toBase58() };
  return { programId, programDataId, connection, config, accounts };
}

test('release accepts the linked program only with the reviewed binary and authority', async () => {
  const { programId, connection, config } = fixture();
  assert.equal((await verifyOptionsProgram(connection, config)).toBase58(), programId.toBase58());
});

test('release blocks changed binary, authority, ProgramData link, or missing review fields', async () => {
  const { programId, connection, config, accounts } = fixture();
  await assert.rejects(verifyOptionsProgram(connection, { ...config, programSha256: '0'.repeat(64) }), /binary differs/);
  await assert.rejects(verifyOptionsProgram(connection, { ...config, upgradeAuthority: null }), /authority differs/);
  await assert.rejects(verifyOptionsProgram(connection, { enabled: true, programId: config.programId }), /missing its reviewed/);
  const program = accounts.get(programId.toBase58());
  program.data = Buffer.from(program.data);
  Keypair.generate().publicKey.toBuffer().copy(program.data, 4);
  await assert.rejects(verifyOptionsProgram(connection, config), /ProgramData account/);
});
