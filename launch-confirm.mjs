export class LaunchPendingError extends Error {
  constructor(signature, mintAddress) {
    super(`Transaction status is not confirmed yet. Check signature ${signature} and Mint ${mintAddress} before retrying.`);
    this.name = 'LaunchPendingError';
    this.signature = signature;
    this.mintAddress = mintAddress;
    this.pending = true;
  }
}

export async function confirmPumpLaunch(connection, signature, latest, mintAddress) {
  let confirmation;
  try {
    confirmation = await connection.confirmTransaction({
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    }, 'confirmed');
  } catch (_) {
    const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true }).catch(() => null);
    if (status?.value?.err) throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
    if (status?.value && ['confirmed', 'finalized'].includes(status.value.confirmationStatus || '')) return;
    throw new LaunchPendingError(signature, mintAddress);
  }
  if (confirmation.value.err) throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
}
