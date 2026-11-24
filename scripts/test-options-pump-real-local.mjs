// Local validator only. Pump's actual mainnet SBF is loaded as a local test program.
import assert from 'node:assert/strict';
import BN from 'bn.js';
import { createRequire } from 'node:module';
const { PUMP_SDK } = createRequire(import.meta.url)('@pump-fun/pump-sdk');
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction,
  getAccount, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';
import { openSeriesInstructions, buyOptionsInstruction, buybackVaultPrepInstructions,
  pumpBuybackInstruction, fetchVerifiedSeries } from '../options-client.mjs';

const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
const programId = new PublicKey(process.argv[2]);
const issuer = Keypair.generate();
const buyer = Keypair.generate();
const send = (instructions, signers) => sendAndConfirmTransaction(connection, new Transaction().add(...instructions), signers, { commitment: 'confirmed' });
for (const wallet of [issuer, buyer]) await connection.confirmTransaction(await connection.requestAirdrop(wallet.publicKey, 100_000_000_000), 'confirmed');

const mintSigner = Keypair.generate();
const mint = mintSigner.publicKey;
const creation = await PUMP_SDK.createV2Instruction({ mint, name: 'Local hmonhook Pump test', symbol: 'HMPTEST',
  uri: 'https://example.org/hmonhook-local-test.json', creator: issuer.publicKey, user: issuer.publicKey,
  mayhemMode: false, holderReward: false });
await send([creation], [issuer, mintSigner]);

const issuerAta = getAssociatedTokenAddressSync(mint, issuer.publicKey, false, TOKEN_2022_PROGRAM_ID);
const pumpBuy = await PUMP_SDK.getBuyExactQuoteInV3InstructionRaw({ user: issuer.publicKey, mint,
  spendableQuoteIn: new BN('2000000000'), minTokensOut: new BN('1') });
pumpBuy.keys[13] = { ...pumpBuy.keys[13], pubkey: new PublicKey('5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD') };
await send([createAssociatedTokenAccountIdempotentInstruction(issuer.publicKey, issuerAta,
  issuer.publicKey, mint, TOKEN_2022_PROGRAM_ID), pumpBuy], [issuer]);
const issuerBalance = (await getAccount(connection, issuerAta, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount;
const supply = (await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID)).supply;
const unit = 1_000_000n;
const deposit = (supply * 2n / 100n / unit) * unit;
assert.ok(issuerBalance > deposit, 'issuer must buy enough Pump tokens to lock 2% of supply');
const slot = await connection.getSlot('confirmed');
const opened = openSeriesInstructions({ programId, issuer: issuer.publicKey, mint, source: issuerAta, treasury: issuerAta,
  nonce: 501n, deposit, strikeLamports: 100n, saleDeadlineSlot: BigInt(slot + 300),
  expirySlot: BigInt(slot + 600), treasuryFloor: issuerBalance - deposit });
await send(opened.instructions, [issuer]);
const lots = deposit / unit;
await send([buyOptionsInstruction({ programId, series: opened.series.address, buyer: buyer.publicKey,
  treasury: issuerAta, lots })], [buyer]);
const prep = buybackVaultPrepInstructions({ programId, series: opened.series.address, mint, payer: issuer.publicKey });
await send(prep.instructions, [issuer]);
const before = await getAccount(connection, prep.vault.baseVault, 'confirmed', TOKEN_2022_PROGRAM_ID);
const spend = 10_000_000n;
const minimum = (spend * unit + 199n) / 200n;
const built = await pumpBuybackInstruction({ programId, series: opened.series.address, mint,
  keeper: buyer.publicKey, spendableQuoteIn: spend, minTokensOut: minimum,
  keeperTopupLamports: 5_000_000n, strikeLamports: 100n, lotSize: unit });
const premiumBalanceBefore = await connection.getBalance(built.vault.authority, 'confirmed');
const signature = await send([built.instruction], [buyer]);
const premiumBalanceAfter = await connection.getBalance(built.vault.authority, 'confirmed');
const after = await getAccount(connection, prep.vault.baseVault, 'confirmed', TOKEN_2022_PROGRAM_ID);
const state = await fetchVerifiedSeries(connection, programId, opened.series.address);
assert.equal(state.premiumSpentLamports, spend);
assert.equal(premiumBalanceBefore - premiumBalanceAfter, Number(spend));
assert.ok(after.amount - before.amount >= minimum);
console.log(JSON.stringify({ programId: programId.toBase58(), mint: mint.toBase58(),
  signature, supply: String(supply), issuerBalance: String(issuerBalance),
  deposit: String(deposit), boughtBack: String(after.amount - before.amount),
  premiumSpent: String(state.premiumSpentLamports), premiumBalanceBefore,
  premiumBalanceAfter }));
