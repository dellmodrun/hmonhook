const MAX_IMAGE_BYTES = 2_000_000;

export async function readBoundedFormData(request, maxBytes = 2_500_000) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new RangeError('Upload exceeds the size limit');
  if (!request.body) throw new Error('Missing upload body');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new RangeError('Upload exceeds the size limit');
    }
    chunks.push(value);
  }
  return new Request(request.url, { method: 'POST', headers: request.headers, body: new Blob(chunks) }).formData();
}

const field = (form, name, max) => {
  const value = form.get(name);
  if (typeof value !== 'string') throw new Error(`Missing ${name}`);
  const cleaned = value.trim();
  if (cleaned.length > max) throw new Error(`${name} is too long`);
  return cleaned;
};

const optionalUrl = (form, name) => {
  const value = field(form, name, 200);
  if (!value) return '';
  try { if (new URL(value).protocol === 'https:') return value; }
  catch (_) { /* Reject below. */ }
  throw new Error(`${name} must be an HTTPS URL`);
};

function imageFormat(bytes) {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return ['image/png', 'png'];
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return ['image/jpeg', 'jpg'];
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return ['image/webp', 'webp'];
  throw new Error('Image must be a PNG, JPEG or WebP file');
}

export async function validateUpload(form) {
  const name = field(form, 'name', 32);
  const symbol = field(form, 'symbol', 13).toUpperCase();
  const description = field(form, 'description', 500);
  if (!name || !description || !/^[A-Z0-9_$.-]{1,13}$/.test(symbol)) throw new Error('Invalid coin name, symbol or description');
  const image = form.get('image');
  if (!image || typeof image.arrayBuffer !== 'function' || !image.size || image.size > MAX_IMAGE_BYTES) throw new Error('Image must be 1 byte to 2 MB');
  const imageBytes = new Uint8Array(await image.arrayBuffer());
  const [imageMime, imageExtension] = imageFormat(imageBytes);
  if (image.type && image.type !== imageMime) throw new Error('Image MIME type does not match its bytes');
  const digest = await crypto.subtle.digest('SHA-256', imageBytes);
  const imageHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { name, symbol, description, website: optionalUrl(form, 'website'), twitter: optionalUrl(form, 'twitter'), telegram: optionalUrl(form, 'telegram'),
    imageBytes, imageMime, imageExtension, imageHash };
}
