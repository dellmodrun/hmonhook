// Read-only preflight for the planned unified h/monhook release. Never sends a transaction.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { SOLANA_MAINNET_GENESIS_HASH } from '../options-network-core.mjs';

const root = resolve(import.meta.dirname, '..');
const keyRoot = resolve(process.env.APPDATA || '', 'hmonhook', 'keys');
const managementAddress = 'DyjJ2cxfL3oYCnazLHB7zpe4sd4mSnQuCbqV5sDGrgmG';
const programs = [
  { kind: 'guard', address: 'Be7RvxKNFa35ER8DSmPoBq6AssMMoJsMU4fBso1E2ELQ',
    keyFile: 'guard-program-keypair.json', binary: 'hmonhook_guard.so',
    expectedSha256: 'f90a8834e85f0e7094aa387000dbcf5e4c337f9cbc160eb537d2b6d36559776c' },
  { kind: 'options', address: 'Cz1jDZv12iXcK5JTY3s4wFX6HH8Y48xDeRxPWDgqshNQ',
    keyFile: 'options-program-keypair.json', binary: 'hmonhook_options.so',
    reviewDirectory: 'options-v3',
    expectedSha256: '9796cb929cfa98310da7d71c10223ec488867958924478f1a54b92c21cfd59a3' },
];

function publicKeyFromFile(file) {
  const secret = JSON.parse(readFileSync(resolve(keyRoot, file), 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(secret)).publicKey.toBase58();
}

function reviewedBinary(program) {
  const directory = resolve(root, '.local-deploy', 'release-review', program.reviewDirectory || program.kind);
  const bytes = readFileSync(resolve(directory, program.binary));
  const hash = createHash('sha256').update(bytes).digest('hex');
  const record = readFileSync(resolve(directory, `${program.binary}.sha256`), 'utf8').trim();
  if (hash !== program.expectedSha256 || record !== `${hash}  artifacts/${program.binary}`) {
    throw new Error(`${program.kind}: SBF differs from the reviewed release digest or CI record`);
  }
  return { bytes: bytes.length, sha256: hash };
}

async function rpcRead(read) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await read(); }
    catch (error) {
      if (attempt === 3) throw error;
      await new Promise((done) => setTimeout(done, attempt * 1000));
    }
  }
}

const blockers = [];
let managementKeyMatches = false;
try { managementKeyMatches = publicKeyFromFile('management-keypair.json') === managementAddress; }
catch { blockers.push('Management keypair is missing or unreadable.'); }
if (!managementKeyMatches && !blockers.some((item) => item.startsWith('Management keypair'))) {
  blockers.push('Management keypair does not match the reserved public address.');
}

for (const program of programs) {
  try {
    if (publicKeyFromFile(program.keyFile) !== program.address) {
      blockers.push(`${program.kind}: program keypair does not match the reserved public address.`);
    }
  } catch { blockers.push(`${program.kind}: program keypair is missing or unreadable.`); }
  try { Object.assign(program, reviewedBinary(program)); }
  catch (error) { blockers.push(error.message); }
}

const rpcUrl = process.env.HMONHOOK_MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(rpcUrl, 'confirmed');
const genesis = await rpcRead(() => connection.getGenesisHash());
if (genesis !== SOLANA_MAINNET_GENESIS_HASH) throw new Error('RPC is not Solana mainnet-beta.');
const balanceLamports = await rpcRead(() => connection.getBalance(new PublicKey(managementAddress)));
const programRent = await rpcRead(() => connection.getMinimumBalanceForRentExemption(36));
let finalRentLamports = 0;
let temporaryBufferRentLamports = 0;
for (const program of programs) {
  program.mainnetAccountExists = (await rpcRead(() => connection.getAccountInfo(new PublicKey(program.address)))) !== null;
  if (program.mainnetAccountExists) blockers.push(`${program.kind}: reserved mainnet program address is already occupied.`);
  if (program.bytes) {
    program.finalAccountRentLamports = programRent +
      await rpcRead(() => connection.getMinimumBalanceForRentExemption(45 + program.bytes));
    program.temporaryBufferRentLamports =
      await rpcRead(() => connection.getMinimumBalanceForRentExemption(37 + program.bytes));
    finalRentLamports += program.finalAccountRentLamports;
    temporaryBufferRentLamports += program.temporaryBufferRentLamports;
  }
}
if (finalRentLamports && balanceLamports < finalRentLamports) {
  blockers.push('Management balance is below minimum final program account rent.');
}

console.log(JSON.stringify({ network: 'mainnet-beta', readOnly: true,
  machineChecksPassed: blockers.length === 0, readyToDeploy: false, managementAddress,
  managementBalanceLamports: balanceLamports, minimumFinalAccountRentLamports: finalRentLamports,
  minimumTemporaryBufferRentLamports: temporaryBufferRentLamports,
  excludesTransactionFeesAndOtherAccounts: true,
  programs: programs.map(({ kind, address, bytes, sha256, mainnetAccountExists,
    finalAccountRentLamports, temporaryBufferRentLamports }) =>
    ({ kind, address, bytes: bytes ?? null, sha256: sha256 ?? null, mainnetAccountExists,
      finalAccountRentLamports: finalAccountRentLamports ?? null,
      temporaryBufferRentLamports: temporaryBufferRentLamports ?? null })),
  machineCheckBlockers: blockers,
  manualReleaseGates: ['funded public-cluster lifecycle tests', 'developer-sale evidence policy',
    'global same-name launch indexing', 'Privacy Rings implementation and verification',
    'independent security review', 'offline authority recovery backup', 'production RPC and monitoring']
}, null, 2));
if (blockers.length) process.exitCode = 2;
