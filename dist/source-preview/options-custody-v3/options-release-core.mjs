import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';

const UPGRADEABLE_LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

export async function verifyOptionsProgram(connection, config) {
  if (!config?.enabled || !config.programId) throw new Error('Issuer options are not enabled on this release.');
  if (!/^[0-9a-f]{64}$/i.test(config.programSha256 || '') ||
      !Object.hasOwn(config, 'upgradeAuthority')) {
    throw new Error('Options release is missing its reviewed binary hash or authority policy.');
  }
  const programId = new PublicKey(config.programId);
  const program = await connection.getAccountInfo(programId, 'confirmed');
  if (!program?.executable || !program.owner.equals(UPGRADEABLE_LOADER) ||
      program.data.length !== 36 || program.data.readUInt32LE(0) !== 2) {
    throw new Error('The configured options program is not a verified upgradeable program.');
  }
  const programDataId = new PublicKey(program.data.subarray(4, 36));
  const programData = await connection.getAccountInfo(programDataId, 'confirmed');
  if (!programData?.owner.equals(UPGRADEABLE_LOADER) || programData.data.length < 45 ||
      programData.data.readUInt32LE(0) !== 3 || ![0, 1].includes(programData.data[12])) {
    throw new Error('Options ProgramData account does not match the expected loader layout.');
  }
  const actualAuthority = programData.data[12] === 1
    ? new PublicKey(programData.data.subarray(13, 45)).toBase58() : null;
  if (actualAuthority !== config.upgradeAuthority) {
    throw new Error('Options program upgrade authority differs from the release policy.');
  }
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', programData.data.subarray(45))).toString('hex');
  if (digest.toLowerCase() !== config.programSha256.toLowerCase()) {
    throw new Error('Options program binary differs from the reviewed release hash.');
  }
  return programId;
}
