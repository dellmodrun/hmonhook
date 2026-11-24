// Local validator only. PumpSwap at its public address is a test double.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, NATIVE_MINT, AuthorityType,
  createMint, getOrCreateAssociatedTokenAccount, getAccount, mintTo, setAuthority } from '@solana/spl-token';
import { createSyncNativeInstruction } from '@solana/spl-token';
import { openSeriesInstructions, buyOptionsInstruction, pumpSwapVaultPrepInstructions,
  pumpSwapBuybackInstruction, fetchVerifiedSeries, refundPremiumInstruction,
  reclaimPumpSwapQuoteRentInstruction, reclaimBuybackRentInstruction } from '../options-client.mjs';

const { PUMP_AMM_PROGRAM_ID, canonicalPumpPoolPda } = createRequire(import.meta.url)('@pump-fun/pump-swap-sdk');
const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
const programId = new PublicKey(process.argv[2]);
const realPumpSwap = process.argv.includes('--real');
const issuer = Keypair.generate();
const buyer = Keypair.generate();
const send = (instructions, signers) => sendAndConfirmTransaction(connection, new Transaction().add(...instructions), signers, { commitment: 'confirmed' });
for (const wallet of [issuer, buyer]) await connection.confirmTransaction(await connection.requestAirdrop(wallet.publicKey, 2_000_000_000), 'confirmed');

const mintSigner = realPumpSwap ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(
  new URL('../.local-deploy/pumpswap-real-mint-keypair.json', import.meta.url), 'utf8')))) : undefined;
const mint = await createMint(connection, issuer, issuer.publicKey, issuer.publicKey, 6, mintSigner, undefined, TOKEN_2022_PROGRAM_ID);
const source = (await getOrCreateAssociatedTokenAccount(connection, issuer, mint, issuer.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID)).address;
await mintTo(connection, issuer, mint, source, issuer, 1_000_000_000n, [], undefined, TOKEN_2022_PROGRAM_ID);
const pool = canonicalPumpPoolPda(mint);
const poolBase = (await getOrCreateAssociatedTokenAccount(connection, issuer, mint, pool, true, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID)).address;
const poolQuote = (await getOrCreateAssociatedTokenAccount(connection, issuer, NATIVE_MINT, pool, true, 'confirmed', undefined, TOKEN_PROGRAM_ID)).address;
await mintTo(connection, issuer, mint, poolBase, issuer, 20_000_000n, [], undefined, TOKEN_2022_PROGRAM_ID);
if (!realPumpSwap) await send([new TransactionInstruction({ programId: PUMP_AMM_PROGRAM_ID, keys: [
  { pubkey: issuer.publicKey, isSigner: true, isWritable: true },
  { pubkey: pool, isSigner: false, isWritable: true },
  { pubkey: mint, isSigner: false, isWritable: false },
  { pubkey: poolBase, isSigner: false, isWritable: false },
  { pubkey: poolQuote, isSigner: false, isWritable: false },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
], data: Buffer.from([0]) })], [issuer]);
await send([SystemProgram.transfer({ fromPubkey: issuer.publicKey, toPubkey: poolQuote, lamports: 10_000 }),
  createSyncNativeInstruction(poolQuote)], [issuer]);
await setAuthority(connection, issuer, mint, issuer, AuthorityType.MintTokens, null, [], undefined, TOKEN_2022_PROGRAM_ID);
await setAuthority(connection, issuer, mint, issuer, AuthorityType.FreezeAccount, null, [], undefined, TOKEN_2022_PROGRAM_ID);

const slot = await connection.getSlot('confirmed');
const opened = openSeriesInstructions({ programId, issuer: issuer.publicKey, mint, source, treasury: source,
  nonce: 301n, deposit: 50_000_000n, strikeLamports: 1_000n,
  saleDeadlineSlot: BigInt(slot + 50), expirySlot: BigInt(slot + 80), treasuryFloor: 900_000_000n });
await send(opened.instructions, [issuer]);
await send([buyOptionsInstruction({ programId, series: opened.series.address, buyer: buyer.publicKey,
  treasury: source, lots: 50n })], [buyer]);
const prep = pumpSwapVaultPrepInstructions({ programId, series: opened.series.address, mint, payer: issuer.publicKey });
await send(prep.instructions, [issuer]);
const built = await pumpSwapBuybackInstruction({ connection, programId, series: opened.series.address,
  mint, keeper: buyer.publicKey, spendableQuoteIn: 2_000n, minTokensOut: 1_000_000n,
  keeperTopupLamports: 2_000_000n, strikeLamports: 1_000n, lotSize: 1_000_000n });
const premiumBefore = await connection.getBalance(built.vault.authority, 'confirmed');
const baseBefore = (await getAccount(connection, built.vault.baseVault, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount;
const wrongVault = { ...built.instruction, keys: built.instruction.keys.map((item) => ({ ...item })) };
wrongVault.keys[7].pubkey = poolQuote;
await assert.rejects(send([wrongVault], [buyer]), /failed|Error|Instruction/i);
const looseOutput = { ...built.instruction, data: Buffer.from(built.instruction.data) };
looseOutput.data.writeBigUInt64LE(1n, 9);
await assert.rejects(send([looseOutput], [buyer]), /failed|Error|Instruction/i);
assert.equal(await connection.getBalance(built.vault.authority, 'confirmed'), premiumBefore);

const signature = await send([built.instruction], [buyer]);
const state = await fetchVerifiedSeries(connection, programId, opened.series.address);
const baseAfter = (await getAccount(connection, built.vault.baseVault, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount;
const quoteAfter = (await getAccount(connection, built.vault.quoteVault, 'confirmed', TOKEN_PROGRAM_ID)).amount;
assert.equal(state.premiumSpentLamports, 2_000n);
assert.equal(await connection.getBalance(built.vault.authority, 'confirmed'), premiumBefore - 2_000);
assert.ok(baseAfter - baseBefore >= 1_000_000n);
if (!realPumpSwap) assert.equal(baseAfter - baseBefore, 1_000_000n);
assert.equal(quoteAfter, 0n);
const overspend = { ...built.instruction, data: Buffer.from(built.instruction.data) };
overspend.data.writeBigUInt64LE(5_001n, 1);
overspend.data.writeBigUInt64LE(3_000_000n, 9);
await assert.rejects(send([overspend], [buyer]), /failed|Error|Instruction/i);
assert.equal((await fetchVerifiedSeries(connection, programId, opened.series.address)).premiumSpentLamports, 2_000n);
while ((await connection.getSlot('confirmed')) <= slot + 80) await new Promise((resolve) => setTimeout(resolve, 350));
await send([refundPremiumInstruction({ programId, series: opened.series.address, buyer: buyer.publicKey })], [buyer]);
const quoteRent = await connection.getBalance(built.vault.quoteVault, 'confirmed');
const issuerBefore = await connection.getBalance(issuer.publicKey, 'confirmed');
await send([reclaimPumpSwapQuoteRentInstruction({ programId, series: opened.series.address, mint,
  issuer: issuer.publicKey })], [buyer]);
assert.equal(await connection.getBalance(built.vault.quoteVault, 'confirmed'), 0);
assert.equal(await connection.getBalance(issuer.publicKey, 'confirmed'), issuerBefore + quoteRent);
await send([reclaimBuybackRentInstruction({ programId, series: opened.series.address,
  issuer: issuer.publicKey })], [buyer]);
assert.equal(await connection.getBalance(built.vault.authority, 'confirmed'), 0);
console.log(JSON.stringify({ realPumpSwap, signature, premiumSpent: '2000', boughtTokens: String(baseAfter - baseBefore) }));
