// Read-only release check for CI SBF artifacts extracted under .local-deploy/release-review.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Connection } from '@solana/web3.js';
import { SOLANA_MAINNET_GENESIS_HASH } from '../options-network-core.mjs';

const root = resolve(import.meta.dirname, '..', '.local-deploy', 'release-review');
const offline = process.argv.includes('--offline');
const requested = process.argv.find((arg) => ['guard', 'options'].includes(arg));
const targets = requested ? [requested] : ['guard', 'options'];
const names = { guard: 'hmonhook_guard', options: 'hmonhook_options' };

export function inspectArtifact(directory, binaryName) {
  const expected = [`${binaryName}.so`, `${binaryName}.so.sha256`];
  const found = readdirSync(directory).sort();
  if (found.length !== 2 || expected.sort().some((file, index) => file !== found[index])) {
    throw new Error(`${binaryName}: artifact must contain only its SBF binary and SHA-256 record.`);
  }
  for (const file of found) {
    if (!lstatSync(resolve(directory, file)).isFile()) throw new Error(`${binaryName}: artifact entry is not a regular file.`);
  }
  const binary = readFileSync(resolve(directory, `${binaryName}.so`));
  const record = readFileSync(resolve(directory, `${binaryName}.so.sha256`), 'utf8').trim();
  const match = /^([0-9a-f]{64})\s+\*?artifacts\/([\w-]+\.so)$/i.exec(record);
  if (!match || match[2] !== `${binaryName}.so` || binary.length === 0) {
    throw new Error(`${binaryName}: malformed or mismatched SHA-256 record.`);
  }
  const sha256 = createHash('sha256').update(binary).digest('hex');
  if (sha256 !== match[1].toLowerCase()) throw new Error(`${binaryName}: SBF hash differs from CI record.`);
  return { name: binaryName, bytes: binary.length, sha256 };
}

const artifacts = targets.map((target) => inspectArtifact(resolve(root, target), names[target]));
if (!offline) {
  const rpc = process.env.HMONHOOK_MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpc, 'confirmed');
  const genesis = await connection.getGenesisHash();
  if (genesis !== SOLANA_MAINNET_GENESIS_HASH) throw new Error('Rent RPC is not Solana mainnet-beta.');
  const programRent = await connection.getMinimumBalanceForRentExemption(36);
  for (const artifact of artifacts) {
    artifact.programRentLamports = programRent;
    artifact.programDataRentLamports = await connection.getMinimumBalanceForRentExemption(45 + artifact.bytes);
    artifact.minimumAccountRentLamports = artifact.programRentLamports + artifact.programDataRentLamports;
  }
}
console.log(JSON.stringify({ cluster: offline ? 'offline hash review' : 'mainnet-beta rent query',
  artifacts, minimumAccountRentLamports: offline ? null : artifacts.reduce((sum, item) => sum + item.minimumAccountRentLamports, 0),
  excludesTemporaryBuffersAndFees: true }, null, 2));
