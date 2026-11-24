// Read-only check of a Kora-deployed Devnet program against a reviewed SBF artifact.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Connection, PublicKey } from '@solana/web3.js';

const loaderId = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const reviewedHashes = {
  guard: 'f90a8834e85f0e7094aa387000dbcf5e4c337f9cbc160eb537d2b6d36559776c',
  options: '1cb1456e1f2bfcbd5c9471ee27793fc7e6af7d9a0cfc5146f59f2f4fd435e16e',
};

const [kind, address] = process.argv.slice(2);
if (!['guard', 'options'].includes(kind) || !address) {
  throw new Error('Usage: node scripts/verify-devnet-program.mjs <guard|options> <program-id>');
}
const artifactDir = resolve(import.meta.dirname, '..', '.local-deploy', 'release-review', kind);
const binary = readFileSync(resolve(artifactDir, `hmonhook_${kind}.so`));
const expectedHash = createHash('sha256').update(binary).digest('hex');
const hashRecord = readFileSync(resolve(artifactDir, `hmonhook_${kind}.so.sha256`), 'utf8').trim();
if (expectedHash !== reviewedHashes[kind] ||
  hashRecord !== `${expectedHash}  artifacts/hmonhook_${kind}.so`) {
  throw new Error('Local SBF does not match the reviewed hash and CI SHA-256 record.');
}
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
async function rpcRead(read) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await read(); }
    catch (error) {
      if (attempt === 3) throw error;
      await new Promise((done) => setTimeout(done, attempt * 1000));
    }
  }
}
if (await rpcRead(() => connection.getGenesisHash()) !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') {
  throw new Error('RPC is not Solana Devnet.');
}
const programId = new PublicKey(address);
const program = await rpcRead(() => connection.getAccountInfo(programId, 'confirmed'));
if (!program || !program.executable || !program.owner.equals(loaderId)
  || program.data.length !== 36 || program.data.readUInt32LE(0) !== 2) {
  throw new Error('Address is not an executable upgradeable program.');
}
const programDataId = new PublicKey(program.data.subarray(4, 36));
const programData = await rpcRead(() => connection.getAccountInfo(programDataId, 'confirmed'));
if (!programData || !programData.owner.equals(loaderId)
  || programData.data.length !== 45 + binary.length || programData.data.readUInt32LE(0) !== 3) {
  throw new Error('ProgramData account is missing or malformed.');
}
const deployed = programData.data.subarray(45, 45 + binary.length);
const deployedHash = createHash('sha256').update(deployed).digest('hex');
if (deployedHash !== expectedHash) throw new Error('Deployed SBF differs from the reviewed CI artifact.');
const authority = programData.data[12] === 1
  ? new PublicKey(programData.data.subarray(13, 45)).toBase58() : null;
console.log(JSON.stringify({ cluster: 'devnet', kind, programId: programId.toBase58(),
  programDataId: programDataId.toBase58(), binaryBytes: binary.length,
  expectedHash, deployedHash, upgradeAuthority: authority }, null, 2));
