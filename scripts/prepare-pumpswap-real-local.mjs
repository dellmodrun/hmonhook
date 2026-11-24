// Prepare an entirely synthetic canonical pool for a local validator loaded
// with PumpSwap's actual deployed SBF. All keys and accounts are local only.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Keypair, PublicKey } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync } from '@solana/spl-token';

const { PUMP_AMM_PROGRAM_ID, canonicalPumpPoolPda, lpMintPda } = createRequire(import.meta.url)('@pump-fun/pump-swap-sdk');
const dir = new URL('../.local-deploy/', import.meta.url);
mkdirSync(dir, { recursive: true });
const mint = Keypair.generate();
const pool = canonicalPumpPoolPda(mint.publicKey);
const pump = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const creator = PublicKey.findProgramAddressSync([Buffer.from('pool-authority'), mint.publicKey.toBuffer()], pump)[0];
const [expected, bump] = PublicKey.findProgramAddressSync([Buffer.from('pool'), Buffer.alloc(2),
  creator.toBuffer(), mint.publicKey.toBuffer(), NATIVE_MINT.toBuffer()], PUMP_AMM_PROGRAM_ID);
if (!expected.equals(pool)) throw new Error('Canonical pool derivation changed.');
const baseVault = getAssociatedTokenAddressSync(mint.publicKey, pool, true, TOKEN_2022_PROGRAM_ID);
const quoteVault = getAssociatedTokenAddressSync(NATIVE_MINT, pool, true, TOKEN_PROGRAM_ID);
const data = Buffer.alloc(270);
Buffer.from([241, 154, 109, 4, 17, 177, 109, 188]).copy(data, 0);
data[8] = bump;
creator.toBuffer().copy(data, 11);
mint.publicKey.toBuffer().copy(data, 43);
NATIVE_MINT.toBuffer().copy(data, 75);
lpMintPda(pool).toBuffer().copy(data, 107);
baseVault.toBuffer().copy(data, 139);
quoteVault.toBuffer().copy(data, 171);
data.writeBigUInt64LE(1n, 203);
const fixture = { pubkey: pool.toBase58(), account: { lamports: 5_000_000,
  data: [data.toString('base64'), 'base64'], owner: PUMP_AMM_PROGRAM_ID.toBase58(),
  executable: false, rentEpoch: 0 } };
writeFileSync(new URL('pumpswap-real-pool.json', dir), JSON.stringify(fixture), { mode: 0o600 });
writeFileSync(new URL('pumpswap-real-mint-keypair.json', dir), JSON.stringify([...mint.secretKey]), { mode: 0o600 });
console.log(JSON.stringify({ pool: pool.toBase58(), mint: mint.publicKey.toBase58(),
  baseVault: baseVault.toBase58(), quoteVault: quoteVault.toBase58(),
  fixture: '.local-deploy/pumpswap-real-pool.json' }));
