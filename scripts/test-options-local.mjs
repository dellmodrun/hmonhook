// Local validator only. This script generates disposable wallets and never uses mainnet.
import assert from 'node:assert/strict';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, AuthorityType, createMint, createAccount,
  getOrCreateAssociatedTokenAccount, getAccount, mintTo, setAuthority,
  createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  openSeriesInstructions, buyOptionsInstruction, exerciseInstructions,
  triggerDefaultInstruction, withdrawRegisteredTreasuryInstruction, claimDefaultInstructions, fetchVerifiedSeries,
  reclaimInstructions,
  refundPremiumInstruction,
  deriveBuybackAuthority,
  reclaimBuybackRentInstruction,
  derivePosition, closePositionInstruction, closeSeriesTokenInstruction, closeSeriesInstruction,
  buybackVaultPrepInstructions, closeEmptyBuybackVaultInstruction,
  claimDefaultForBuyerInstructions, refundPremiumForBuyerInstruction,
  reclaimExpiredForIssuerInstructions, withdrawExpiredTreasuryForIssuerInstructions,
  listVerifiedSeriesByMint,
} from '../options-client.mjs';
import { createMockPumpCurve } from './local-pump-curve.mjs';

const endpoint = 'http://127.0.0.1:8899';
const connection = new Connection(endpoint, 'confirmed');
const programId = new PublicKey(process.argv[2]);
const issuer = Keypair.generate();
const buyer = Keypair.generate();
const keeper = Keypair.generate();
const decimals = 6;
const unit = 10 ** decimals;
const send = async (instructions, signers) => sendAndConfirmTransaction(connection, new Transaction().add(...instructions), signers, { commitment: 'confirmed' });
const fund = async (wallet) => connection.confirmTransaction(await connection.requestAirdrop(wallet.publicKey, 2_000_000_000), 'confirmed');

await fund(issuer);
await fund(buyer);
await fund(keeper);
const mint = await createMint(connection, issuer, issuer.publicKey, issuer.publicKey, decimals, undefined, undefined, TOKEN_2022_PROGRAM_ID);
const source = (await getOrCreateAssociatedTokenAccount(connection, issuer, mint, issuer.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID)).address;
const unmonitored = await createAccount(connection, issuer, mint, issuer.publicKey, Keypair.generate(), undefined, TOKEN_2022_PROGRAM_ID);
await mintTo(connection, issuer, mint, source, issuer, 1000 * unit, [], undefined, TOKEN_2022_PROGRAM_ID);
await setAuthority(connection, issuer, mint, issuer, AuthorityType.MintTokens, null, [], undefined, TOKEN_2022_PROGRAM_ID);
await setAuthority(connection, issuer, mint, issuer, AuthorityType.FreezeAccount, null, [], undefined, TOKEN_2022_PROGRAM_ID);
await send([createMockPumpCurve({ payer: issuer.publicKey, mint }).instruction], [issuer]);

const slot = await connection.getSlot('confirmed');
const wrongStrike = openSeriesInstructions({
  programId, issuer: issuer.publicKey, mint, source, nonce: 5n,
  deposit: BigInt(50 * unit), strikeLamports: 999n,
  saleDeadlineSlot: BigInt(slot + 1_000), expirySlot: BigInt(slot + 2_000),
  treasuryFloor: BigInt(950 * unit),
});
let wrongStrikeRejected = false;
try { await send(wrongStrike.instructions, [issuer]); }
catch (_) { wrongStrikeRejected = true; }
assert.ok(wrongStrikeRejected, 'the contract must reject a strike that differs from the Pump curve');
const rejectedSource = openSeriesInstructions({
  programId, issuer: issuer.publicKey, mint, source, nonce: 6n,
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
  programId, issuer: issuer.publicKey, mint, source, nonce: 7n,
  deposit: BigInt(50 * unit), strikeLamports: 1_000n,
  saleDeadlineSlot: BigInt(slot + 1_000), expirySlot: BigInt(slot + 2_000),
  treasuryFloor: BigInt(950 * unit),
});
const openSignature = await send(opened.instructions, [issuer]);
let series = await fetchVerifiedSeries(connection, programId, opened.series.address);
assert.equal(series.totalLots, 50n);
assert.ok((await listVerifiedSeriesByMint(connection, programId, mint)).some((row) => row.address.equals(opened.series.address)));
assert.equal((await getAccount(connection, opened.series.vault, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount, BigInt(50 * unit));
assert.equal((await getAccount(connection, opened.series.treasury, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount, BigInt(950 * unit));

let prematureDefaultRejected = false;
try { await send([triggerDefaultInstruction({ programId, series: opened.series.address })], [buyer]); }
catch (_) { prematureDefaultRejected = true; }
assert.ok(prematureDefaultRejected, 'default must require a breached registered treasury');

const premiumVault = deriveBuybackAuthority(programId, opened.series.address);
const premiumsBeforeBuy = await connection.getBalance(premiumVault, 'confirmed');
const buySignature = await send([buyOptionsInstruction({ programId, series: opened.series.address, buyer: buyer.publicKey, lots: 2n })], [buyer]);
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

let unauthorizedWithdrawRejected = false;
try { await send([withdrawRegisteredTreasuryInstruction({ programId, issuer: buyer.publicKey,
  series: opened.series.address, mint, destination: exercised.destination })], [buyer]); }
catch (_) { unauthorizedWithdrawRejected = true; }
assert.ok(unauthorizedWithdrawRejected, 'only the issuer may withdraw the registered allocation');
let redirectedWithdrawRejected = false;
try { await send([withdrawRegisteredTreasuryInstruction({ programId, issuer: issuer.publicKey,
  series: opened.series.address, mint, destination: exercised.destination })], [issuer]); }
catch (_) { redirectedWithdrawRejected = true; }
assert.ok(redirectedWithdrawRejected, 'the issuer cannot redirect custody to a buyer token account');
const defaultSignature = await send([withdrawRegisteredTreasuryInstruction({ programId, issuer: issuer.publicKey,
  series: opened.series.address, mint, destination: source })], [issuer]);
assert.equal((await getAccount(connection, source, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount, BigInt(950 * unit));
let postBreachPurchaseRejected = false;
try { await send([buyOptionsInstruction({ programId, series: opened.series.address, buyer: buyer.publicKey, lots: 1n })], [buyer]); }
catch (_) { postBreachPurchaseRejected = true; }
assert.ok(postBreachPurchaseRejected, 'new options cannot be bought after registered treasury outflow');
series = await fetchVerifiedSeries(connection, programId, opened.series.address);
assert.equal(series.status, 1);

const claimed = claimDefaultForBuyerInstructions({ programId, series: opened.series.address, mint,
  vault: opened.series.vault, issuer: issuer.publicKey, buyer: buyer.publicKey,
  keeper: keeper.publicKey, lots: 1n });
const divertedDefault = claimDefaultForBuyerInstructions({ programId, series: opened.series.address, mint,
  vault: opened.series.vault, issuer: issuer.publicKey, buyer: buyer.publicKey,
  keeper: keeper.publicKey, lots: 1n });
divertedDefault.instructions[1].keys[6] = { pubkey: source, isSigner: false, isWritable: true };
let divertedDefaultRejected = false;
try { await send(divertedDefault.instructions, [keeper]); } catch (_) { divertedDefaultRejected = true; }
assert.ok(divertedDefaultRejected, 'a keeper cannot redirect the default payout');
const claimSignature = await send(claimed.instructions, [keeper]);
assert.equal((await getAccount(connection, claimed.destination, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount, BigInt(2 * unit));
let duplicateClaimRejected = false;
try { await send(claimed.instructions, [keeper]); } catch (_) { duplicateClaimRejected = true; }
assert.ok(duplicateClaimRejected, 'duplicate default claim must fail');

const expiryStart = await connection.getSlot('confirmed');
const expiring = openSeriesInstructions({
  programId, issuer: issuer.publicKey, mint, source, nonce: 8n,
  deposit: BigInt(50 * unit), strikeLamports: 1_000n,
  saleDeadlineSlot: BigInt(expiryStart + 10), expirySlot: BigInt(expiryStart + 50),
  treasuryFloor: BigInt(900 * unit),
});
await send(expiring.instructions, [issuer]);
const emptyBuybackVault = buybackVaultPrepInstructions({ programId, series: expiring.series.address,
  mint, payer: issuer.publicKey });
await send(emptyBuybackVault.instructions, [issuer]);
await send([buyOptionsInstruction({ programId, series: expiring.series.address, buyer: buyer.publicKey, lots: 2n })], [buyer]);
const refund = refundPremiumInstruction({ programId, series: expiring.series.address, buyer: buyer.publicKey });
let prematureRefundRejected = false;
try { await send([refund], [buyer]); } catch (_) { prematureRefundRejected = true; }
assert.ok(prematureRefundRejected, 'premium refunds cannot precede expiry');
while ((await connection.getSlot('confirmed')) <= expiryStart + 10) await new Promise((resolve) => setTimeout(resolve, 350));
let expiredSaleRejected = false;
try { await send([buyOptionsInstruction({ programId, series: expiring.series.address, buyer: buyer.publicKey, lots: 1n })], [buyer]); }
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
const reclaimSignature = await send(reclaimExpiredForIssuerInstructions({ programId,
  issuer: issuer.publicKey, series: expiring.series.address, mint, vault: expiring.series.vault,
  keeper: keeper.publicKey }).instructions, [keeper]);
const expiringState = await fetchVerifiedSeries(connection, programId, expiring.series.address);
assert.equal(expiringState.status, 2);
await send(withdrawExpiredTreasuryForIssuerInstructions({ programId, issuer: issuer.publicKey,
  series: expiring.series.address, mint, keeper: keeper.publicKey }).instructions, [keeper]);
assert.equal((await fetchVerifiedSeries(connection, programId, expiring.series.address)).status, 2);
assert.equal(expiringState.reclaimedLots, 49n);
assert.equal((await getAccount(connection, expiring.series.vault, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount, 0n);
let expiredExerciseRejected = false;
try { await send(exerciseInstructions({ programId, series: expiring.series.address, mint, vault: expiring.series.vault, issuer: issuer.publicKey, buyer: buyer.publicKey, lots: 1n }).instructions, [buyer]); }
catch (_) { expiredExerciseRejected = true; }
assert.ok(expiredExerciseRejected, 'exercise after expiry must fail');
const expiringPremiumVault = deriveBuybackAuthority(programId, expiring.series.address);
const closePosition = closePositionInstruction({ programId, series: expiring.series.address, buyer: buyer.publicKey });
let pendingRefundCloseRejected = false;
try { await send([closePosition], [keeper]); } catch (_) { pendingRefundCloseRejected = true; }
assert.ok(pendingRefundCloseRejected, 'a Position cannot close while its premium refund remains claimable');
const premiumBalanceBeforeRefund = await connection.getBalance(expiringPremiumVault, 'confirmed');
const divertedRefund = refundPremiumForBuyerInstruction({ programId, series: expiring.series.address,
  buyer: buyer.publicKey });
divertedRefund.keys[0] = { pubkey: keeper.publicKey, isSigner: false, isWritable: true };
let divertedRefundRejected = false;
try { await send([divertedRefund], [keeper]); } catch (_) { divertedRefundRejected = true; }
assert.ok(divertedRefundRejected, 'a keeper cannot redirect a premium refund');
const buyerBalanceBeforeRefund = await connection.getBalance(buyer.publicKey, 'confirmed');
const refundSignature = await send([refundPremiumForBuyerInstruction({ programId,
  series: expiring.series.address, buyer: buyer.publicKey })], [keeper]);
assert.equal((await connection.getBalance(buyer.publicKey, 'confirmed')) - buyerBalanceBeforeRefund, 200);
const refundedState = await fetchVerifiedSeries(connection, programId, expiring.series.address);
assert.equal(refundedState.premiumRefundedLamports, 200n);
assert.equal(refundedState.premiumRefundClaimedLots, 2n);
assert.equal(premiumBalanceBeforeRefund - await connection.getBalance(expiringPremiumVault, 'confirmed'), 200);
let duplicateRefundRejected = false;
try { await send([refundPremiumForBuyerInstruction({ programId,
  series: expiring.series.address, buyer: buyer.publicKey })], [keeper]); } catch (_) { duplicateRefundRejected = true; }
assert.ok(duplicateRefundRejected, 'the same position cannot claim a premium refund twice');
const rentReturn = reclaimBuybackRentInstruction({ programId, series: expiring.series.address, issuer: issuer.publicKey });
const rentBeforeReturn = await connection.getBalance(expiringPremiumVault, 'confirmed');
await send([rentReturn], [buyer]);
assert.ok(rentBeforeReturn > 0);
assert.equal(await connection.getBalance(expiringPremiumVault, 'confirmed'), 0);
const closeSeries = closeSeriesInstruction({ programId, series: expiring.series.address, mint, issuer: issuer.publicKey });
let prematureSeriesCloseRejected = false;
try { await send([closeSeries], [keeper]); } catch (_) { prematureSeriesCloseRejected = true; }
assert.ok(prematureSeriesCloseRejected, 'a Series cannot close while its Position and vaults remain');
const positionAddress = derivePosition(programId, expiring.series.address, buyer.publicKey);
const positionRent = await connection.getBalance(positionAddress, 'confirmed');
assert.ok(positionRent > 0);
const buyerBeforeClose = await connection.getBalance(buyer.publicKey, 'confirmed');
await send([closePosition], [keeper]);
assert.equal(await connection.getBalance(positionAddress, 'confirmed'), 0);
assert.equal((await connection.getBalance(buyer.publicKey, 'confirmed')) - buyerBeforeClose, positionRent);
assert.equal((await fetchVerifiedSeries(connection, programId, expiring.series.address)).closedPositionLots, 2n);
await send([closeSeriesTokenInstruction({ programId, series: expiring.series.address, mint,
  issuer: issuer.publicKey, kind: 'collateral' })], [keeper]);
await send([closeSeriesTokenInstruction({ programId, series: expiring.series.address, mint,
  issuer: issuer.publicKey, kind: 'treasury' })], [keeper]);
assert.equal(await connection.getBalance(expiring.series.vault, 'confirmed'), 0);
assert.equal(await connection.getBalance(expiring.series.treasury, 'confirmed'), 0);
const buybackVaultRent = await connection.getBalance(emptyBuybackVault.vault.baseVault, 'confirmed');
assert.ok(buybackVaultRent > 0);
await send([closeEmptyBuybackVaultInstruction({ programId, series: expiring.series.address,
  mint, issuer: issuer.publicKey })], [keeper]);
assert.equal(await connection.getBalance(emptyBuybackVault.vault.baseVault, 'confirmed'), 0);
const seriesRent = await connection.getBalance(expiring.series.address, 'confirmed');
assert.ok(seriesRent > 0);
const issuerBeforeClose = await connection.getBalance(issuer.publicKey, 'confirmed');
await send([closeSeries], [keeper]);
assert.equal(await connection.getBalance(expiring.series.address, 'confirmed'), 0);
assert.equal((await connection.getBalance(issuer.publicKey, 'confirmed')) - issuerBeforeClose, seriesRent);

// A defaulted buyer may be inactive. A keeper must be able to deliver that
// buyer's entitlement, refund unused premium, and finish the shutdown.
const defaultStart = await connection.getSlot('confirmed');
const defaulted = openSeriesInstructions({ programId, issuer: issuer.publicKey, mint, source, nonce: 9n,
  deposit: BigInt(50 * unit), strikeLamports: 1_000n,
  saleDeadlineSlot: BigInt(defaultStart + 10), expirySlot: BigInt(defaultStart + 50),
  treasuryFloor: BigInt(800 * unit),
});
await send(defaulted.instructions, [issuer]);
await send([buyOptionsInstruction({ programId, series: defaulted.series.address,
  buyer: buyer.publicKey, lots: 1n })], [buyer]);
await send([withdrawRegisteredTreasuryInstruction({ programId, issuer: issuer.publicKey,
  series: defaulted.series.address, mint, destination: source })], [issuer]);
assert.equal((await fetchVerifiedSeries(connection, programId, defaulted.series.address)).status, 1);
while ((await connection.getSlot('confirmed')) <= defaultStart + 50) await new Promise((resolve) => setTimeout(resolve, 350));
const defaultClosePosition = closePositionInstruction({ programId, series: defaulted.series.address,
  buyer: buyer.publicKey });
let outstandingDefaultClaimCloseRejected = false;
try { await send([defaultClosePosition], [keeper]); } catch (_) { outstandingDefaultClaimCloseRejected = true; }
assert.ok(outstandingDefaultClaimCloseRejected, 'defaulted Position cannot close before its buyer receives tokens');
const defaultClaim = claimDefaultForBuyerInstructions({ programId, series: defaulted.series.address,
  mint, vault: defaulted.series.vault, issuer: issuer.publicKey, buyer: buyer.publicKey,
  keeper: keeper.publicKey, lots: 1n });
await send(defaultClaim.instructions, [keeper]);
await send(reclaimExpiredForIssuerInstructions({ programId, issuer: issuer.publicKey,
  series: defaulted.series.address, mint, vault: defaulted.series.vault,
  keeper: keeper.publicKey }).instructions, [keeper]);
await send([refundPremiumForBuyerInstruction({ programId, series: defaulted.series.address,
  buyer: buyer.publicKey })], [keeper]);
await send([reclaimBuybackRentInstruction({ programId, series: defaulted.series.address,
  issuer: issuer.publicKey })], [keeper]);
await send([defaultClosePosition], [keeper]);
for (const kind of ['collateral', 'treasury']) {
  await send([closeSeriesTokenInstruction({ programId, series: defaulted.series.address, mint,
    issuer: issuer.publicKey, kind })], [keeper]);
}
await send([closeSeriesInstruction({ programId, series: defaulted.series.address,
  mint, issuer: issuer.publicKey })], [keeper]);
assert.equal(await connection.getBalance(defaulted.series.address, 'confirmed'), 0);

console.log(JSON.stringify({
  network: endpoint, programId: programId.toBase58(), series: opened.series.address.toBase58(),
  openSignature, buySignature, exerciseSignature, defaultSignature, claimSignature,
  prematureDefaultRejected, unmonitoredSourceRejected, postBreachPurchaseRejected, divertedExerciseRejected, expiredSaleRejected, unauthorizedReclaimRejected,
  unauthorizedWithdrawRejected, redirectedWithdrawRejected,
  duplicateClaimRejected, divertedDefaultRejected, earlyReclaimSignature, reclaimSignature, expiredExerciseRejected,
  prematureRefundRejected, refundSignature, duplicateRefundRejected,
  prematureSeriesCloseRejected, pendingRefundCloseRejected,
  divertedRefundRejected,
  positionRentReturned: positionRent, seriesRentReturned: seriesRent,
  buybackVaultRentReturned: buybackVaultRent,
  outstandingDefaultClaimCloseRejected, defaultedSeriesClosedByKeeper: true,
}, null, 2));
