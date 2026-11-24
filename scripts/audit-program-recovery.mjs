// Read-only mainnet shutdown audit. Never signs, closes, or transfers anything.
import { Connection, PublicKey } from '@solana/web3.js';
import { SOLANA_MAINNET_GENESIS_HASH } from '../options-network-core.mjs';

const rpc = process.env.HMONHOOK_MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(rpc, 'confirmed');
const loader = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const management = 'DyjJ2cxfL3oYCnazLHB7zpe4sd4mSnQuCbqV5sDGrgmG';
const programs = [
  ['guard', 'Be7RvxKNFa35ER8DSmPoBq6AssMMoJsMU4fBso1E2ELQ'],
  ['options', 'Cz1jDZv12iXcK5JTY3s4wFX6HH8Y48xDeRxPWDgqshNQ'],
];

if (await connection.getGenesisHash() !== SOLANA_MAINNET_GENESIS_HASH) {
  throw new Error('The RPC is not Solana mainnet-beta.');
}
const rows = [];
for (const [kind, id] of programs) {
  const programId = new PublicKey(id);
  const program = await connection.getAccountInfo(programId, 'confirmed');
  if (!program) {
    rows.push({ kind, programId: id, deployed: false, closeEligible: false });
    continue;
  }
  if (!program.executable || !program.owner.equals(loader) || program.data.length !== 36 ||
      program.data.readUInt32LE(0) !== 2) {
    rows.push({ kind, programId: id, deployed: true, closeEligible: false,
      reason: 'Program account is not the expected upgradeable-loader layout.' });
    continue;
  }
  const dataId = new PublicKey(program.data.subarray(4, 36));
  const data = await connection.getAccountInfo(dataId, 'confirmed');
  if (!data || !data.owner.equals(loader) || data.data.length < 45 ||
      data.data.readUInt32LE(0) !== 3 || ![0, 1].includes(data.data[12])) {
    rows.push({ kind, programId: id, programDataId: dataId.toBase58(), deployed: true,
      closeEligible: false, reason: 'ProgramData is missing or malformed.' });
    continue;
  }
  const authority = data.data[12] === 1 ? new PublicKey(data.data.subarray(13, 45)).toBase58() : null;
  const row = { kind, programId: id, programDataId: dataId.toBase58(), deployed: true,
    upgradeAuthority: authority, authorityRetained: authority === management,
    programRentLamports: program.lamports, programDataRentLamports: data.lamports };
  if (kind === 'options') {
    try {
      const accounts = await connection.getProgramAccounts(programId, {
        commitment: 'confirmed', dataSlice: { offset: 0, length: 8 },
      });
      row.remainingStateAccounts = accounts.length;
      row.remainingStateTags = [...new Set(accounts.map(({ account }) => account.data.toString('ascii')))].sort();
    } catch (error) {
      row.remainingStateAccounts = null;
      row.stateScanError = String(error).slice(0, 180);
    }
  }
  row.closeEligible = row.authorityRetained &&
    (kind !== 'options' || row.remainingStateAccounts === 0);
  rows.push(row);
}
console.log(JSON.stringify({ network: 'mainnet-beta', readOnly: true, managementAddress: management,
  warning: 'Eligibility is only a pre-close check. Verify all user obligations and token vaults before closing a program.',
  programs: rows }, null, 2));
if (rows.some((row) => row.deployed && !row.closeEligible)) process.exitCode = 2;
