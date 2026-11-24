import { PublicKey } from '@solana/web3.js';

export const OPTIONS_PROGRAM_ID = new PublicKey('Cz1jDZv12iXcK5JTY3s4wFX6HH8Y48xDeRxPWDgqshNQ');
const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const encoder = new TextEncoder();

function address(bytes) { return new PublicKey(bytes); }

export function verifiedV3Series(account, seriesAddress, expectedMint) {
  try {
    if (!account || account.owner !== OPTIONS_PROGRAM_ID.toBase58() || account.executable ||
        !Array.isArray(account.data) || account.data[1] !== 'base64') return null;
    const raw = atob(account.data[0]);
    if (raw.length !== 274 || raw.slice(0, 8) !== 'HMONOPT3') return null;
    const bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
    const status = bytes[8];
    if (status > 2) return null;
    const bump = bytes[9];
    const nonce = new DataView(bytes.buffer).getBigUint64(10, true);
    const issuer = address(bytes.slice(18, 50));
    const mint = address(bytes.slice(50, 82));
    const vault = address(bytes.slice(82, 114));
    const treasury = address(bytes.slice(114, 146));
    const registeredAmount = new DataView(bytes.buffer).getBigUint64(146, true);
    if (!registeredAmount || !mint.equals(new PublicKey(expectedMint))) return null;
    const [derived, expectedBump] = PublicKey.findProgramAddressSync([
      encoder.encode('series'), mint.toBuffer(), issuer.toBuffer(),
      Uint8Array.from({ length: 8 }, (_, index) => Number((nonce >> BigInt(8 * index)) & 255n)),
    ], OPTIONS_PROGRAM_ID);
    const [derivedTreasury] = PublicKey.findProgramAddressSync([
      encoder.encode('treasury'), derived.toBuffer(),
    ], OPTIONS_PROGRAM_ID);
    const [derivedVault] = PublicKey.findProgramAddressSync([
      derived.toBuffer(), TOKEN_2022.toBuffer(), mint.toBuffer(),
    ], ATA_PROGRAM);
    if (!derived.equals(new PublicKey(seriesAddress)) || bump !== expectedBump ||
        !vault.equals(derivedVault) || !treasury.equals(derivedTreasury)) return null;
    return { address: derived.toBase58(), mint: mint.toBase58(), issuer: issuer.toBase58() };
  } catch { return null; }
}
