import { Buffer } from 'buffer';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';

const MAYHEM_PROGRAM_ID = new PublicKey('MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e');
const OFFICIAL_PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_PROGRAM_ID = OFFICIAL_PUMP_PROGRAM_ID;
const DISCRIMINATOR = 'd6904cec5f8b31b4';
const pda = (program, ...seeds) => PublicKey.findProgramAddressSync(seeds.map((seed) => Buffer.from(seed)), program)[0];

// Only the SOL-paired, standard-fee Token-2022 route is supported by this launcher.
export function assertPumpCreateV2Route(instruction, { mint, user, name, symbol, uri }) {
  const mintKey = new PublicKey(mint);
  const userKey = new PublicKey(user);
  const curve = pda(OFFICIAL_PUMP_PROGRAM_ID, 'bonding-curve', mintKey.toBuffer());
  const mayhemVault = pda(MAYHEM_PROGRAM_ID, 'sol-vault');
  const expected = [
    mintKey,
    pda(OFFICIAL_PUMP_PROGRAM_ID, 'mint-authority'),
    curve,
    getAssociatedTokenAddressSync(mintKey, curve, true, TOKEN_2022_PROGRAM_ID),
    pda(OFFICIAL_PUMP_PROGRAM_ID, 'global'),
    userKey,
    SystemProgram.programId,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    MAYHEM_PROGRAM_ID,
    pda(MAYHEM_PROGRAM_ID, 'global-params'),
    mayhemVault,
    pda(MAYHEM_PROGRAM_ID, 'mayhem-state', mintKey.toBuffer()),
    getAssociatedTokenAddressSync(mintKey, mayhemVault, true, TOKEN_2022_PROGRAM_ID),
    pda(OFFICIAL_PUMP_PROGRAM_ID, '__event_authority'),
    OFFICIAL_PUMP_PROGRAM_ID,
  ];
  if (!PUMP_PROGRAM_ID.equals(OFFICIAL_PUMP_PROGRAM_ID) || !instruction.programId.equals(OFFICIAL_PUMP_PROGRAM_ID) || instruction.keys.length !== expected.length ||
    expected.some((pubkey, index) => !instruction.keys[index].pubkey.equals(pubkey)) ||
    !instruction.keys[0].isSigner || !instruction.keys[5].isSigner) {
    throw new Error('Safety check failed: Pump create_v2 accounts changed. The wallet was not asked to sign.');
  }
  const data = Buffer.from(instruction.data);
  if (data.subarray(0, 8).toString('hex') !== DISCRIMINATOR) {
    throw new Error('Safety check failed: this is not the expected Pump create_v2 instruction.');
  }
  let offset = 8;
  for (const expectedValue of [name, symbol, uri]) {
    if (offset + 4 > data.length) throw new Error('Safety check failed: incomplete Pump creation data.');
    const length = data.readUInt32LE(offset);
    offset += 4;
    if (length > data.length - offset || data.subarray(offset, offset + length).toString('utf8') !== expectedValue) {
      throw new Error('Safety check failed: Pump creation metadata changed.');
    }
    offset += length;
  }
  if (offset + 33 > data.length || !data.subarray(offset, offset + 32).equals(userKey.toBuffer()) ||
    data.subarray(offset + 32).some((byte) => byte !== 0)) {
    throw new Error('Safety check failed: Pump creator or launch settings changed.');
  }
}
