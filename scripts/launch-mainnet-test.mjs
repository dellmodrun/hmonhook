import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const { PUMP_PROGRAM_ID, PUMP_SDK } = createRequire(import.meta.url)("@pump-fun/pump-sdk");
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { assertPumpCreateV2Route } from "../pump-launch-route.mjs";

if (process.argv.includes("--send")) throw new Error("Mainnet sending is disabled until the unified h/monhook release is approved.");
const keypairPath = process.env.HMONHOOK_KEYPAIR_PATH;
if (!keypairPath) throw new Error("Set HMONHOOK_KEYPAIR_PATH to a protected simulation wallet keypair file.");

const secret = Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8")));
const payer = Keypair.fromSecretKey(secret);
const mint = Keypair.generate();
const rpc = process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com";
const metadataUri = process.env.HMONHOOK_TEST_METADATA_URI || "https://hmonhook-launch-api.zaunmanx.chatgpt.site/metadata/75216601136c79f3ba6138f5b08c058ef7029afb6d90950d248a31a7151b78c1.json";
const connection = new Connection(rpc, "confirmed");

const instruction = await PUMP_SDK.createV2Instruction({
  mint: mint.publicKey,
  name: "Hmonhook API Test",
  symbol: "APITEST",
  uri: metadataUri,
  creator: payer.publicKey,
  user: payer.publicKey,
  mayhemMode: false,
  holderReward: false,
});

assertPumpCreateV2Route(instruction, { mint: mint.publicKey, user: payer.publicKey,
  name: "Hmonhook API Test", symbol: "APITEST", uri: metadataUri });

const latest = await connection.getLatestBlockhash("confirmed");
const transaction = new Transaction({
  feePayer: payer.publicKey,
  recentBlockhash: latest.blockhash,
}).add(instruction);
transaction.sign(payer, mint);

const [balance, fee, simulation] = await Promise.all([
  connection.getBalance(payer.publicKey, "confirmed"),
  connection.getFeeForMessage(transaction.compileMessage(), "confirmed"),
  connection.simulateTransaction(transaction),
]);

const report = {
  mode: "simulation-only",
  network: "solana-mainnet-beta",
  payer: payer.publicKey.toBase58(),
  payerBalanceSol: balance / 1_000_000_000,
  estimatedTransactionFeeSol: (fee.value || 0) / 1_000_000_000,
  mint: mint.publicKey.toBase58(),
  metadataUri,
  pumpProgram: instruction.programId.toBase58(),
  accountCount: instruction.keys.length,
  simulationError: simulation.value.err,
  simulationUnits: simulation.value.unitsConsumed,
  simulationLogs: simulation.value.logs,
};

if (simulation.value.err) {
  console.log(JSON.stringify(report, null, 2));
  throw new Error("Mainnet simulation failed; transaction was not sent.");
}

console.log(JSON.stringify(report, null, 2));
