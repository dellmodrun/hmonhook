// Local validator only. Generates disposable wallets and never uses mainnet.
import assert from 'node:assert/strict';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount,
  mintTo, getAccount, createTransferCheckedInstruction,
} from '@solana/spl-token';
import { buildExecuteIntentInstruction } from '../hmonhook-sdk/dist/index.js';

const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
const programId = new PublicKey(process.argv[2]);
const payer = Keypair.generate();
const recipient = Keypair.generate();
await connection.confirmTransaction(await connection.requestAirdrop(payer.publicKey, 1_000_000_000), 'confirmed');
const mint = await createMint(connection, payer, payer.publicKey, null, 6, undefined, undefined, TOKEN_2022_PROGRAM_ID);
const source = (await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID)).address;
const destination = (await getOrCreateAssociatedTokenAccount(connection, payer, mint, recipient.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID)).address;
await mintTo(connection, payer, mint, source, payer, 5_000_000, [], undefined, TOKEN_2022_PROGRAM_ID);
const transfer = createTransferCheckedInstruction(source, mint, destination, payer.publicKey, 1_000_000, 6, [], TOKEN_2022_PROGRAM_ID);
const routeAccounts = transfer.keys.map((meta) => ({
  address: meta.pubkey.toBase58(),
  role: (meta.isWritable ? 1 : 0) | (meta.isSigner ? 2 : 0),
}));
const built = buildExecuteIntentInstruction({
  programAddress: programId.toBase58(),
  authority: payer.publicKey.toBase58(),
  sourceTokenAccount: source.toBase58(),
  destinationTokenAccount: destination.toBase58(),
  routeProgram: TOKEN_2022_PROGRAM_ID.toBase58(),
  routeAccounts,
  routeData: transfer.data,
  constraints: { expiresAtSlot: 0n, maxInput: 1_000_000n, minOutput: 1_000_000n },
});
const guarded = new TransactionInstruction({
  programId,
  keys: built.accounts.map((meta) => ({
    pubkey: new PublicKey(meta.address),
    isWritable: (meta.role & 1) !== 0,
    isSigner: (meta.role & 2) !== 0,
  })),
  data: Buffer.from(built.data),
});
const signature = await sendAndConfirmTransaction(connection, new Transaction().add(guarded), [payer], { commitment: 'confirmed' });
assert.equal((await getAccount(connection, source, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount, 4_000_000n);
assert.equal((await getAccount(connection, destination, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount, 1_000_000n);

const tooStrict = buildExecuteIntentInstruction({
  programAddress: programId.toBase58(), authority: payer.publicKey.toBase58(),
  sourceTokenAccount: source.toBase58(), destinationTokenAccount: destination.toBase58(),
  routeProgram: TOKEN_2022_PROGRAM_ID.toBase58(), routeAccounts,
  routeData: transfer.data,
  constraints: { expiresAtSlot: 0n, maxInput: 999_999n, minOutput: 1_000_000n },
});
const rejectedInstruction = new TransactionInstruction({
  programId,
  keys: tooStrict.accounts.map((meta) => ({
    pubkey: new PublicKey(meta.address),
    isWritable: (meta.role & 1) !== 0,
    isSigner: (meta.role & 2) !== 0,
  })),
  data: Buffer.from(tooStrict.data),
});
let maxInputRejected = false;
try {
  await sendAndConfirmTransaction(connection, new Transaction().add(rejectedInstruction), [payer], { commitment: 'confirmed' });
} catch (_) { maxInputRejected = true; }
assert.ok(maxInputRejected, 'guard must reject a route above maxInput');
assert.equal((await getAccount(connection, source, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount, 4_000_000n);
console.log(JSON.stringify({ programId: programId.toBase58(), signature, maxInputRejected }));
