// Local validator only; the Pump program at its public address is a test double.
import assert from 'node:assert/strict';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, AuthorityType, createMint, getOrCreateAssociatedTokenAccount,
  getAccount, mintTo, setAuthority } from '@solana/spl-token';
import { openSeriesInstructions, buyOptionsInstruction, buybackVaultPrepInstructions,
  pumpBuybackInstruction, fetchVerifiedSeries, refundPremiumInstruction } from '../options-client.mjs';
import { reclaimBuybackRentInstruction } from '../options-client.mjs';
import { createMockPumpCurve } from './local-pump-curve.mjs';

const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
const programId = new PublicKey(process.argv[2]);
const issuer = Keypair.generate();
const buyer = Keypair.generate();
const send = (instructions, signers) => sendAndConfirmTransaction(connection, new Transaction().add(...instructions), signers, { commitment: 'confirmed' });
for (const wallet of [issuer, buyer]) await connection.confirmTransaction(await connection.requestAirdrop(wallet.publicKey, 2_000_000_000), 'confirmed');

const mint = await createMint(connection, issuer, issuer.publicKey, issuer.publicKey, 6, undefined, undefined, TOKEN_2022_PROGRAM_ID);
const source = (await getOrCreateAssociatedTokenAccount(connection, issuer, mint, issuer.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID)).address;
await mintTo(connection, issuer, mint, source, issuer, 1_000_000_000n, [], undefined, TOKEN_2022_PROGRAM_ID);
const { curve, instruction: createCurve } = createMockPumpCurve({ payer: issuer.publicKey, mint });
await send([createCurve], [issuer]);
const curveAta = (await getOrCreateAssociatedTokenAccount(connection, issuer, mint, curve, true, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID)).address;
await mintTo(connection, issuer, mint, curveAta, issuer, 20_000_000n, [], undefined, TOKEN_2022_PROGRAM_ID);
await setAuthority(connection, issuer, mint, issuer, AuthorityType.MintTokens, null, [], undefined, TOKEN_2022_PROGRAM_ID);
await setAuthority(connection, issuer, mint, issuer, AuthorityType.FreezeAccount, null, [], undefined, TOKEN_2022_PROGRAM_ID);

const slot = await connection.getSlot('confirmed');
const opened = openSeriesInstructions({ programId, issuer: issuer.publicKey, mint, source, treasury: source,
  nonce: 201n, deposit: 50_000_000n, strikeLamports: 1_000n,
  saleDeadlineSlot: BigInt(slot + 80), expirySlot: BigInt(slot + 115), treasuryFloor: 900_000_000n });
await send(opened.instructions, [issuer]);
const series = opened.series.address;
const prep = buybackVaultPrepInstructions({ programId, series, mint, payer: issuer.publicKey });
await send(prep.instructions, [issuer]);
const partial = openSeriesInstructions({ programId, issuer: issuer.publicKey, mint, source, treasury: source,
  nonce: 202n, deposit: 50_000_000n, strikeLamports: 1_000n,
  saleDeadlineSlot: BigInt(slot + 80), expirySlot: BigInt(slot + 115), treasuryFloor: 850_000_000n });
await send(partial.instructions, [issuer]);
await send([buyOptionsInstruction({ programId, series: partial.series.address, buyer: buyer.publicKey, treasury: source, lots: 2n })], [buyer]);
const partialBuyback = await pumpBuybackInstruction({ programId, series: partial.series.address, mint, keeper: buyer.publicKey,
  spendableQuoteIn: 100n, minTokensOut: 50_000n, keeperTopupLamports: 2_000_000n,
  strikeLamports: 1_000n, lotSize: 1_000_000n });
await assert.rejects(send([partialBuyback.instruction], [buyer]), /failed|Error|Instruction/i);
assert.equal((await fetchVerifiedSeries(connection, programId, partial.series.address)).premiumSpentLamports, 0n);

await send([buyOptionsInstruction({ programId, series, buyer: buyer.publicKey, treasury: source, lots: 50n })], [buyer]);
const built = await pumpBuybackInstruction({ programId, series, mint, keeper: buyer.publicKey,
  spendableQuoteIn: 2_000n, minTokensOut: 1_000_000n, keeperTopupLamports: 2_000_000n,
  strikeLamports: 1_000n, lotSize: 1_000_000n });
const balanceBefore = await connection.getBalance(built.vault.authority, 'confirmed');
const wrongVault = { ...built.instruction, keys: built.instruction.keys.map((key) => ({ ...key })) };
wrongVault.keys[11].pubkey = curveAta;
await assert.rejects(send([wrongVault], [buyer]), /failed|Error|Instruction/i);
assert.equal(await connection.getBalance(built.vault.authority, 'confirmed'), balanceBefore);
const looseOutput = { ...built.instruction, data: Buffer.from(built.instruction.data) };
looseOutput.data.writeBigUInt64LE(1n, 9);
await assert.rejects(send([looseOutput], [buyer]), /failed|Error|Instruction/i);
assert.equal(await connection.getBalance(built.vault.authority, 'confirmed'), balanceBefore);

const signature = await send([built.instruction], [buyer]);
const after = await fetchVerifiedSeries(connection, programId, series);
assert.equal(after.premiumSpentLamports, 2_000n);
assert.equal(await connection.getBalance(built.vault.authority, 'confirmed'), balanceBefore - 2_000);
assert.equal((await getAccount(connection, built.vault.baseVault, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount, 1_000_000n);
const repeatTooLarge = { ...built.instruction, data: Buffer.from(built.instruction.data) };
repeatTooLarge.data.writeBigUInt64LE(4_000n, 1);
repeatTooLarge.data.writeBigUInt64LE(2_000_000n, 9);
await assert.rejects(send([repeatTooLarge], [buyer]), /failed|Error|Instruction/i);
assert.equal((await fetchVerifiedSeries(connection, programId, series)).premiumSpentLamports, 2_000n);

while ((await connection.getSlot('confirmed')) <= slot + 115) await new Promise((resolve) => setTimeout(resolve, 350));
const refund = refundPremiumInstruction({ programId, series, buyer: buyer.publicKey });
await send([refund], [buyer]);
const refunded = await fetchVerifiedSeries(connection, programId, series);
assert.equal(refunded.premiumRefundedLamports, 3_000n);
assert.equal(refunded.premiumSpentLamports, 2_000n);
const rentReturn = reclaimBuybackRentInstruction({ programId, series, issuer: issuer.publicKey });
const redirectedRent = { ...rentReturn, keys: rentReturn.keys.map((key) => ({ ...key })) };
redirectedRent.keys[2].pubkey = buyer.publicKey;
await assert.rejects(send([redirectedRent], [buyer]), /failed|Error|Instruction/i);
await send([rentReturn], [buyer]);
assert.equal(await connection.getBalance(built.vault.authority, 'confirmed'), 0);
console.log(JSON.stringify({ mockPump: true, signature, premiumSpent: String(refunded.premiumSpentLamports),
  premiumRefunded: String(refunded.premiumRefundedLamports), boughtTokens: '1000000' }));
