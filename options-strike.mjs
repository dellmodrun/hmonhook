import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { createRequire } from 'node:module';
const { PumpSdk, PUMP_PROGRAM_ID, bondingCurvePda, isSolLikeQuoteMint } = createRequire(import.meta.url)('@pump-fun/pump-sdk');
import { strikeFromPumpReserves } from './options-strike-core.mjs';
export { strikeFromPumpReserves } from './options-strike-core.mjs';

/** Reads the Mint and its Pump curve together so the quoted reserves share one RPC slot. */
export async function fetchPumpStrikeSuggestion(connection, mintAddress) {
  const mint = new PublicKey(mintAddress);
  const curveAddress = bondingCurvePda(mint);
  const response = await connection.getMultipleAccountsInfoAndContext([mint, curveAddress], 'confirmed');
  const [mintInfo, curveInfo] = response.value;
  if (!mintInfo || !mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) || !mintInfo.data || mintInfo.data.length < 82 || mintInfo.data[45] !== 1) {
    throw new Error('Expected an initialized Token-2022 Mint');
  }
  if (!curveInfo || !curveInfo.owner.equals(PUMP_PROGRAM_ID)) throw new Error('Pump bonding curve is missing');
  const curve = new PumpSdk().decodeBondingCurve(curveInfo);
  if (!isSolLikeQuoteMint(curve.quoteMint)) throw new Error('Only SOL-quoted Pump curves can set a SOL strike');
  const quote = strikeFromPumpReserves({
    virtualQuoteReserves: curve.virtualQuoteReserves.toString(),
    virtualTokenReserves: curve.virtualTokenReserves.toString(),
    realTokenReserves: curve.realTokenReserves.toString(),
    decimals: mintInfo.data[44],
    complete: curve.complete,
  });
  return { mint: mint.toBase58(), curveAddress: curveAddress.toBase58(), slot: response.context.slot,
    virtualQuoteReserves: curve.virtualQuoteReserves.toString(),
    virtualTokenReserves: curve.virtualTokenReserves.toString(),
    realTokenReserves: curve.realTokenReserves.toString(),
    decimals: mintInfo.data[44], ...quote };
}
