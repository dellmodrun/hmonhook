const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const CREATE_V2_DISCRIMINATOR = 'd6904cec5f8b31b4';
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const encoder = new TextDecoder('utf-8', { fatal: true });

function decodeBase58(value) {
  let number = 0n;
  for (const character of value) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) throw new Error('Invalid base58');
    number = number * 58n + BigInt(digit);
  }
  const bytes = [];
  while (number > 0n) { bytes.unshift(Number(number & 255n)); number >>= 8n; }
  for (const character of value) { if (character === '1') bytes.unshift(0); else break; }
  return new Uint8Array(bytes);
}

function parseCreateV2(data) {
  const bytes = decodeBase58(data);
  if (Array.from(bytes.slice(0, 8), b => b.toString(16).padStart(2, '0')).join('') !== CREATE_V2_DISCRIMINATOR) return null;
  let offset = 8;
  const readString = () => {
    if (offset + 4 > bytes.length) throw new Error('Truncated create_v2 data');
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
    offset += 4;
    if (length > 200 || offset + length > bytes.length) throw new Error('Invalid create_v2 string');
    const value = encoder.decode(bytes.slice(offset, offset + length));
    offset += length;
    return value;
  };
  const name = readString();
  const symbol = readString();
  const metadataUri = readString();
  if (offset + 32 > bytes.length) throw new Error('Missing creator address');
  return { name, symbol, metadataUri, creatorBytes: bytes.slice(offset, offset + 32) };
}

export function verifiedLaunch(transaction, mint, creator) {
  if (!transaction || transaction.meta?.err !== null) return null;
  const message = transaction.transaction?.message;
  const keys = [...(message?.accountKeys || []), ...(transaction.meta?.loadedAddresses?.writable || []), ...(transaction.meta?.loadedAddresses?.readonly || [])];
  if (!keys.length || keys[0] !== creator) return null;
  const creatorBytes = decodeBase58(creator);
  if (creatorBytes.length !== 32) return null;
  for (const instruction of message.instructions || []) {
    if (keys[instruction.programIdIndex] !== PUMP_PROGRAM || instruction.accounts?.length < 16) continue;
    if (keys[instruction.accounts[0]] !== mint || keys[instruction.accounts[5]] !== creator) continue;
    let data;
    try { data = parseCreateV2(instruction.data); }
    catch (_) { continue; }
    if (!data || data.creatorBytes.some((value, index) => value !== creatorBytes[index])) continue;
    if (!data.name || data.name.length > 32 || !data.symbol || data.symbol.length > 13 || data.metadataUri.length > 200) continue;
    if (!/^https:\/\//.test(data.metadataUri)) continue;
    return { mint, signature: transaction.transaction.signatures[0], creator, name: data.name, symbol: data.symbol, metadata_uri: data.metadataUri };
  }
  return null;
}
