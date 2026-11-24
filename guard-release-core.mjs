import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';
import { SOLANA_MAINNET_GENESIS_HASH } from './options-network-core.mjs';

export const HMONHOOK_GUARD_MAINNET = 'Be7RvxKNFa35ER8DSmPoBq6AssMMoJsMU4fBso1E2ELQ';
export const HMONHOOK_GUARD_SHA256 = 'f90a8834e85f0e7094aa387000dbcf5e4c337f9cbc160eb537d2b6d36559776c';
export const HMONHOOK_GUARD_AUTHORITY = 'DyjJ2cxfL3oYCnazLHB7zpe4sd4mSnQuCbqV5sDGrgmG';
const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

export async function verifyGuardProgram(connection) {
  if (await connection.getGenesisHash() !== SOLANA_MAINNET_GENESIS_HASH) {
    throw new Error('The selected RPC is not Solana mainnet. Protected trading is blocked.');
  }
  const id = new PublicKey(HMONHOOK_GUARD_MAINNET);
  const program = await connection.getAccountInfo(id, 'confirmed');
  if (!program?.executable || !program.owner.equals(LOADER) ||
      program.data.length !== 36 || program.data.readUInt32LE(0) !== 2) {
    throw new Error('The h/monhook Guard program is missing or has an unexpected loader.');
  }
  const dataId = new PublicKey(program.data.subarray(4, 36));
  const programData = await connection.getAccountInfo(dataId, 'confirmed');
  if (!programData?.owner.equals(LOADER) || programData.data.length < 45 ||
      programData.data.readUInt32LE(0) !== 3 || programData.data[12] !== 1 ||
      new PublicKey(programData.data.subarray(13, 45)).toBase58() !== HMONHOOK_GUARD_AUTHORITY) {
    throw new Error('The h/monhook Guard upgrade authority does not match this release.');
  }
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', programData.data.subarray(45))).toString('hex');
  if (digest !== HMONHOOK_GUARD_SHA256) {
    throw new Error('The h/monhook Guard binary does not match this release.');
  }
  return id;
}
