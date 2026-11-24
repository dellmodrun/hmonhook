import { AccountRole, address } from '@solana/kit';
import { buildJupiterIntentInstruction } from './hmonhook-sdk/src/index.js';
import { HMONHOOK_GUARD_MAINNET, verifyGuardProgram } from './guard-release-core.mjs';
import {
  AddressLookupTableAccount, ComputeBudgetProgram, Connection, PublicKey,
  TransactionInstruction, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';

const HMONHOOK_MAINNET = new PublicKey(HMONHOOK_GUARD_MAINNET);
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const DEFAULT_RPC = 'https://solana-rpc.publicnode.com';

type ApiInstruction = { programId: string; accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>; data: string };
type Provider = { signAndSendTransaction?: (tx: VersionedTransaction, options?: object) => Promise<string | { signature: string }>; signTransaction?: (tx: VersionedTransaction) => Promise<VersionedTransaction> };

function apiInstruction(ix: ApiInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((account) => ({ pubkey: new PublicKey(account.pubkey), isSigner: account.isSigner, isWritable: account.isWritable })),
    data: Buffer.from(ix.data, 'base64'),
  });
}

function kitInstruction(ix: ReturnType<typeof buildJupiterIntentInstruction>): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys: (ix.accounts || []).map((account) => ({
      pubkey: new PublicKey(account.address),
      isSigner: account.role === AccountRole.READONLY_SIGNER || account.role === AccountRole.WRITABLE_SIGNER,
      isWritable: account.role === AccountRole.WRITABLE || account.role === AccountRole.WRITABLE_SIGNER,
    })),
    data: Buffer.from(ix.data || []),
  });
}

function associatedToken(mint: PublicKey, owner: PublicKey, tokenProgram: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM)[0];
}

export async function submitProtectedSwap(args: {
  provider: Provider; authority: string; inputMint: string; outputMint: string;
  amount: string; minimumOutput: string; slippageBps: string; expiresAtSlot: string; rpcEndpoint?: string;
}) {
  if (!args.provider) throw new Error('Connect a supported wallet first.');
  const authority = new PublicKey(args.authority);
  const inputMint = new PublicKey(args.inputMint);
  const outputMint = new PublicKey(args.outputMint);
  const rpcUrl = new URL(args.rpcEndpoint || DEFAULT_RPC);
  if (rpcUrl.protocol !== 'https:') throw new Error('The RPC endpoint must use HTTPS.');
  const connection = new Connection(rpcUrl.href, 'confirmed');
  await verifyGuardProgram(connection);
  const mintAccounts = await connection.getMultipleAccountsInfo([inputMint, outputMint], 'confirmed');
  if (!mintAccounts[0] || !mintAccounts[1]) throw new Error('Input or output mint does not exist on mainnet.');
  const sourceTokenAccount = associatedToken(inputMint, authority, mintAccounts[0].owner);
  const destinationTokenAccount = associatedToken(outputMint, authority, mintAccounts[1].owner);
  const params = new URLSearchParams({
    inputMint: args.inputMint, outputMint: args.outputMint, amount: args.amount,
    taker: args.authority, slippageBps: args.slippageBps, transactionVersion: '0', maxBytes: '900',
  });
  const response = await fetch(`https://api.jup.ag/swap/v2/build?${params}`);
  if (!response.ok) throw new Error(`Jupiter build failed with HTTP ${response.status}`);
  const build = await response.json();
  if (!build.swapInstruction) throw new Error(build.errorMessage || build.errorCode || 'Jupiter returned no swap instruction');
  if (String(build.inputMint) !== args.inputMint || String(build.outputMint) !== args.outputMint || String(build.inAmount) !== args.amount) {
    throw new Error('Jupiter returned a route for different trade fields. Request a new quote.');
  }

  const guard = buildJupiterIntentInstruction({
    guardProgramAddress: address(HMONHOOK_MAINNET.toBase58()), authority: address(args.authority),
    sourceTokenAccount: address(sourceTokenAccount.toBase58()), destinationTokenAccount: address(destinationTokenAccount.toBase58()),
    swapInstruction: build.swapInstruction, expiresAtSlot: BigInt(args.expiresAtSlot),
    maxInput: BigInt(args.amount), minOutput: BigInt(args.minimumOutput),
  });
  const lookupTables = Object.entries(build.addressesByLookupTableAddress || {}).map(([key, addresses]) => new AddressLookupTableAccount({
    key: new PublicKey(key), state: { deactivationSlot: 0xffff_ffff_ffff_ffffn, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses: (addresses as string[]).map((item) => new PublicKey(item)) },
  }));
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ...(build.computeBudgetInstructions || []).map(apiInstruction),
    ...(build.setupInstructions || []).map(apiInstruction),
    kitInstruction(guard),
    ...(build.cleanupInstruction ? [apiInstruction(build.cleanupInstruction)] : []),
    ...(build.otherInstructions || []).map(apiInstruction),
  ];
  // Jupiter's blockhash can be older than the RPC used to submit the final
  // protected transaction. Keep the quoted instruction bytes and user limits,
  // but take a fresh lifetime from that RPC immediately before wallet signing.
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({ payerKey: authority, recentBlockhash: blockhash, instructions }).compileToV0Message(lookupTables);
  const transaction = new VersionedTransaction(message);
  if (transaction.serialize().length > 1232) {
    throw new Error('This route is too large for a protected Solana transaction. Choose another pair or amount.');
  }
  let signature: string;
  if (args.provider.signAndSendTransaction) {
    const result = await args.provider.signAndSendTransaction(transaction, { preflightCommitment: 'confirmed', maxRetries: 3 });
    signature = typeof result === 'string' ? result : result.signature;
  } else if (args.provider.signTransaction) {
    const signed = await args.provider.signTransaction(transaction);
    const wire = signed.serialize();
    try {
      signature = await connection.sendRawTransaction(wire, { preflightCommitment: 'confirmed', maxRetries: 3 });
    } catch (primaryError) {
      // PublicNode serves account reads but can reject transaction writes.
      // Re-sending the same signed bytes through the official mainnet RPC keeps
      // the signature and user-approved transaction unchanged.
      if (rpcUrl.origin !== 'https://solana-rpc.publicnode.com' ||
          !/403|429|fetch failed|network/i.test(String(primaryError))) throw primaryError;
      signature = await new Connection('https://api.mainnet.solana.com', 'confirmed')
        .sendRawTransaction(wire, { preflightCommitment: 'confirmed', maxRetries: 3 });
    }
  } else throw new Error('This wallet cannot sign versioned Solana transactions.');
  const confirmation = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  if (confirmation.value.err) throw new Error(`Protected transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  return { signature, intentId: Buffer.from(guard.data || []).subarray(29, 61).toString('hex'), explorer: `https://solscan.io/tx/${signature}` };
}
