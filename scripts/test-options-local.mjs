// Local validator only. This script generates disposable wallets and never uses mainnet.
import assert from 'node:assert/strict';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, AuthorityType, createMint, createAccount,
  getOrCreateAssociatedTokenAccount, getAccount, mintTo, setAuthority,
  createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
} from '@solana/spl-token';
import {
  openSeriesInstructions, buyOptionsInstruction, exerciseInstructions,
  triggerDefaultInstruction, claimDefaultInstructions, fetchVerifiedSeries,
  reclaimInstructions,
  refundPremiumInstruction,
  deriveBuybackAuthority,
  reclaimBuybackRentInstruction,
  listVerifiedSeriesByMint,
} from '../options-client.mjs';
import { createMockPumpCurve } from './local-pump-curve.mjs';

const endpoint = 'http://127.0.0.1:8899';
const connection = new Connection(endpoint, 'confirmed');
const programId = new PublicKey(process.argv[2]);
const issuer = Keypair.generate();
const buyer = Keypair.generate();
const decimals = 6;
const unit = 10 ** decimals;
const send = async (instructions, signers) => sendAndConfirmTransaction(connection, new Transaction().add(...instructions), signers, { commitment: 'confirmed' });
const fund = async (wallet) => connection.confirmTransaction(await connection.requestAirdrop(wallet.publicKey, 2_000_000_000), 'confirmed');

await fund(issuer);
await fund(buyer);
const mint = await createMint(connection, issuer, issuer.publicKey, issuer.publicKey, decimals, undefined, undefined, TOKEN_2022_PROGRAM_ID);
const source = (await getOrCreateAssociatedTokenAccount(connection, issuer, mint, issuer.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID)).address;
const treasury = source;
const unmonitored = await createAccount(connection, issuer, mint, issuer.publicKey, Keypair.generate(), undefined, TOKEN_2022_PROGRAM_ID);
await mintTo(connection, issuer, mint, source, issuer, 1000 * unit, [], undefined, TOKEN_2022_PROGRAM_ID);
await setAuthority(connection, issuer, mint, issuer, AuthorityType.MintTokens, null, [], undefined, TOKEN_2022_PROGRAM_ID);
await setAuthority(connection, issuer, mint, issuer, AuthorityType.FreezeAccount, null, [], undefined, TOKEN_2022_PROGRAM_ID);
await send([createMockPumpCurve({ payer: issuer.publicKey, mint }).instruction], [issuer]);

const slot = await connection.getSlot('confirmed');
const wrongStrike = openSeriesInstructions({
  programId, issuer: issuer.publicKey, mint, source, treasury, nonce: 5n,
  deposit: BigInt(50 * unit), strikeLamports: 999n,
  saleDeadlineSlot: BigInt(slot + 1_000), expirySlot: BigInt(slot + 2_000),
  treasuryFloor: BigInt(950 * unit),
});
let wrongStrikeRejected = false;
try { await send(wrongStrike.instructions, [issuer]); }
catch (_) { wrongStrikeRejected = true; }
assert.ok(wrongStrikeRejected, 'the contract must reject a strike that differs from the Pump curve');
const rejectedSource = openSeriesInstructions({
  programId, issuer: issuer.publicKey, mint, source, treasury, nonce: 6n,
  deposit: BigInt(50 * unit), strikeLamports: 1_000n,
  saleDeadlineSlot: BigInt(slot + 1_000), expirySlot: BigInt(slot + 2_000),
  treasuryFloor: BigInt(950 * unit),
});
rejectedSource.instructions[1].keys[4] = { pubkey: unmonitored, isSigner: false, isWritable: false };
let unmonitoredSourceRejected = false;
try { await send(rejectedSource.instructions, [issuer]); }
catch (_) { unmonitoredSourceRejected = true; }
assert.ok(unmonitoredSourceRejected, 'the collateral source must be the monitored treasury');
const opened = openSeriesInstructions({
  programId, issuer: issuer.publicKey, mint, source, treasury, nonce: 7n,
  deposit: BigInt(50 * unit), strikeLamports: 1_000n,
  saleDeadlineSlot: BigInt(slot + 1_000), expirySlot: BigInt(slot + 2_000),
  treasuryFloor: BigInt(950 * unit),
});
const openSignature = await send(opened.instructions, [issuer]);
let series = await fetchVerifiedSeries(connection, programId, opened.series.address);
assert.equal(series.totalLots, 50n);
assert.ok((await listVerifiedSeriesByMint(connection, programId, mint)).some((row) => row.address.equals(opened.series.address)));
assert.equal((await getAccount(connection, opened.series.vault, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount, BigInt(50 * unit));

let prematureDefaultRejected = false;
try { await send([triggerDefaultInstruction({ programId, series: opened.series.address, treasury })], [buyer]); }
catch (_) { prematureDefaultRejected = true; }
assert.ok(prematureDefaultRejected, 'default must require a breached registered treasury');

const premiumVault = deriveBuybackAuthority(programId, opened.series.address);
const premiumsBeforeBuy = await connection.getBalance(premiumVault, 'confirmed');
const buySignature = await send([buyOptionsInstruction({ programId, series: opened.series.address, buyer: buyer.publicKey, treasury, lots: 2n })], [buyer]);
series = await fetchVerifiedSeries(connection, programId, opened.series.address);
assert.equal(series.soldLots, 2n);
assert.equal((await connection.getBalance(premiumVault, 'confirmed')) - premiumsBeforeBuy, 200);

const exercised = exerciseInstructions({ programId, series: opened.series.address, mint, vault: opened.series.vault, issuer: issuer.publicKey, buyer: buyer.publicKey, lots: 1n });
const diverted = exerciseInstructions({ programId, series: opened.series.address, mint, vault: opened.series.vault, issuer: issuer.publicKey, buyer: buyer.publicKey, lots: 1n });
diverted.instructions[1].keys[6] = { pubkey: source, isSigner: false, isWritable: true };
let divertedExerciseRejected = false;
try { await send(diverted.instructions, [buyer]); } catch (_) { divertedExerciseRejected = true; }
assert.ok(divertedExerciseRejected, 'buyer cannot redirect the option payout to an issuer token account');
assert.equal((await getAccount(connection, opened.series.vault, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount, BigInt(50 * unit));
const exerciseSignature = await send(exercised.instructions, [buyer]);
assert.equal((await getAccount(connection, exercised.destination, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount, BigInt(unit));

const buyerTreasuryDestination = getAssociatedTokenAddressSync(mint, buyer.publicKey, false, TOKEN_2022_PROGRAM_ID);
await send([
  createAssociatedTokenAccountIdempotentInstruction(issuer.publicKey, buyerTreasuryDestination, buyer.publicKey, mint, TOKEN_2022_PROGRAM_ID),
  createTransferCheckedInstruction(treasury, mint, buyerTreasuryDestination, issuer.publicKey, unit, decimals, [], TOKEN_2022_PROGRAM_ID),
], [issuer]);
let postBreachPurchaseRejected = false;
try { await send([buyOptionsInstruction({ programId, series: opened.series.address, buyer: buyer.publicKey, treasury, lots: 1n })], [buyer]); }
catch (_) { postBreachPurchaseRejected = true; }
assert.ok(postBreachPurchaseRejected, 'new options cannot be bought after registered treasury outflow');
const defaultSignature = await send([triggerDefaultInstruction({ programId, series: opened.series.address, treasury })], [buyer]);
series = await fetchVerifiedSeries(connection, programId, opened.series.address);
assert.equal(series.status, 1);

const claimed = claimDefaultInstructions({ programId, series: opened.series.address, mint, vault: opened.series.vault, issuer: issuer.publicKey, buyer: buyer.publicKey, lots: 1n });
const claimSignature = await send(claimed.instructions, [buyer]);
assert.equal((await getAccount(connection, claimed.destination, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount, BigInt(3 * unit));
let duplicateClaimRejected = false;
try { await send(claimed.instructions, [buyer]); } catch (_) { duplicateClaimRejected = true; }
assert.ok(duplicateClaimRejected, 'duplicate default claim must fail');

const expiryStart = await connection.getSlot('confirmed');
const expiring = openSeriesInstructions({
  programId, issuer: issuer.publicKey, mint, source, treasury, nonce: 8n,
  deposit: BigInt(50 * unit), strikeLamports: 1_000n,
  saleDeadlineSlot: BigInt(expiryStart + 10), expirySlot: BigInt(expiryStart + 50),
  treasuryFloor: BigInt(899 * unit),
});
await send(expiring.instructions, [issuer]);
await send([buyOptionsInstruction({ programId, series: expiring.series.address, buyer: buyer.publicKey, treasury, lots: 2n })], [buyer]);
const refund = refundPremiumInstruction({ programId, series: expiring.series.address, buyer: buyer.publicKey });
let prematureRefundRejected = false;
try { await send([refund], [buyer]); } catch (_) { prematureRefundRejected = true; }
assert.ok(prematureRefundRejected, 'premium refunds cannot precede expiry');
while ((await connection.getSlot('confirmed')) <= expiryStart + 10) await new Promise((resolve) => setTimeout(resolve, 350));
let expiredSaleRejected = false;
try { await send([buyOptionsInstruction({ programId, series: expiring.series.address, buyer: buyer.publicKey, treasury, lots: 1n })], [buyer]); }
catch (_) { expiredSaleRejected = true; }
assert.ok(expiredSaleRejected, 'option purchases after the sale deadline must fail');
const unauthorized = reclaimInstructions({ programId, issuer: buyer.publicKey, series: expiring.series.address, mint, vault: expiring.series.vault });
let unauthorizedReclaimRejected = false;
try { await send(unauthorized.instructions, [buyer]); } catch (_) { unauthorizedReclaimRejected = true; }
assert.ok(unauthorizedReclaimRejected, 'a buyer cannot reclaim the issuer collateral');
assert.equal((await getAccount(connection, expiring.series.vault, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount, BigInt(50 * unit));
const reclaim = reclaimInstructions({ programId, issuer: issuer.publicKey, series: expiring.series.address, mint, vault: expiring.series.vault });
const earlyReclaimSignature = await send(reclaim.instructions, [issuer]);
assert.equal((await getAccount(connection, expiring.series.vault, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount, BigInt(2 * unit));
await send(exerciseInstructions({ programId, series: expiring.series.address, mint, vault: expiring.series.vault, issuer: issuer.publicKey, buyer: buyer.publicKey, lots: 1n }).instructions, [buyer]);
assert.equal((await getAccount(connection, expiring.series.vault, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount, BigInt(unit));
while ((await connection.getSlot('confirmed')) <= expiryStart + 50) await new Promise((resolve) => setTimeout(resolve, 350));
const reclaimSignature = await send(reclaim.instructions, [issuer]);
const expiringState = await fetchVerifiedSeries(connection, programId, expiring.series.address);
assert.equal(expiringState.status, 2);
assert.equal(expiringState.reclaimedLots, 49n);
assert.equal((await getAccount(connection, expiring.series.vault, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount, 0n);
let expiredExerciseRejected = false;
try { await send(exerciseInstructions({ programId, series: expiring.series.address, mint, vault: expiring.series.vault, issuer: issuer.publicKey, buyer: buyer.publicKey, lots: 1n }).instructions, [buyer]); }
catch (_) { expiredExerciseRejected = true; }
assert.ok(expiredExerciseRejected, 'exercise after expiry must fail');
const expiringPremiumVault = deriveBuybackAuthority(programId, expiring.series.address);
const premiumBalanceBeforeRefund = await connection.getBalance(expiringPremiumVault, 'confirmed');
const refundSignature = await send([refund], [buyer]);
const refundedState = await fetchVerifiedSeries(connection, programId, expiring.series.address);
assert.equal(refundedState.premiumRefundedLamports, 200n);
assert.equal(refundedState.premiumRefundClaimedLots, 2n);
assert.equal(premiumBalanceBeforeRefund - await connection.getBalance(expiringPremiumVault, 'confirmed'), 200);
let duplicateRefundRejected = false;
try { await send([refund], [buyer]); } catch (_) { duplicateRefundRejected = true; }
assert.ok(duplicateRefundRejected, 'the same position cannot claim a premium refund twice');
const rentReturn = reclaimBuybackRentInstruction({ programId, series: expiring.series.address, issuer: issuer.publicKey });
const rentBeforeReturn = await connection.getBalance(expiringPremiumVault, 'confirmed');
await send([rentReturn], [buyer]);
assert.ok(rentBeforeReturn > 0);
assert.equal(await connection.getBalance(expiringPremiumVault, 'confirmed'), 0);

console.log(JSON.stringify({
  network: endpoint, programId: programId.toBase58(), series: opened.series.address.toBase58(),
  openSignature, buySignature, exerciseSignature, defaultSignature, claimSignature,
  prematureDefaultRejected, unmonitoredSourceRejected, postBreachPurchaseRejected, divertedExerciseRejected, expiredSaleRejected, unauthorizedReclaimRejected,
  duplicateClaimRejected, earlyReclaimSignature, reclaimSignature, expiredExerciseRejected,
  prematureRefundRejected, refundSignature, duplicateRefundRejected,
}, null, 2));
