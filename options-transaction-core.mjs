import { PublicKey, Transaction } from '@solana/web3.js';

export async function submitOptionsInstructions({ connection, provider, authority, instructions }) {
  if (!provider?.publicKey || !new PublicKey(String(provider.publicKey)).equals(authority)) {
    throw new Error('Connected wallet changed. Review and prepare this transaction again.');
  }
  const latest = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({ feePayer: authority, recentBlockhash: latest.blockhash }).add(...instructions);
  // Legacy web3.js skips signature verification for an unsigned Transaction.
  // The on-chain program remains the final authority if state changes later.
  const simulation = await connection.simulateTransaction(transaction);
  if (simulation.value.err) {
    throw new Error(`Option transaction simulation failed: ${JSON.stringify(simulation.value.err)}`);
  }
  let signature;
  if (typeof provider.signAndSendTransaction === 'function') {
    const sent = await provider.signAndSendTransaction(transaction, { preflightCommitment: 'confirmed', maxRetries: 3 });
    signature = typeof sent === 'string' ? sent : sent.signature;
  } else if (typeof provider.signTransaction === 'function') {
    const signed = await provider.signTransaction(transaction);
    signature = await connection.sendRawTransaction(signed.serialize(), { preflightCommitment: 'confirmed', maxRetries: 3 });
  } else throw new Error('This wallet cannot sign a Solana transaction.');
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature || '')) throw new Error('Wallet returned no valid signature.');
  try {
    const confirmation = await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
    if (confirmation.value.err) return { signature, status: 'failed', error: confirmation.value.err };
    return { signature, status: 'confirmed' };
  } catch (_) {
    const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (status?.err) return { signature, status: 'failed', error: status.err };
    return { signature, status: status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized'
      ? 'confirmed' : 'pending' };
  }
}
