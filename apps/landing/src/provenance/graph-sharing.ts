/**
 * Compress/decompress provenance graph JSON for URL sharing.
 *
 * Uses DecompressionStream/CompressionStream (available in all modern browsers)
 * with deflate-raw encoding, then base64url-encodes the result.
 */

async function deflate(input: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(input);
  const ab = new ArrayBuffer(encoded.length);
  new Uint8Array(ab).set(encoded);
  const stream = new Blob([ab])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(compressed: Uint8Array): Promise<string> {
  const ab = new ArrayBuffer(compressed.length);
  new Uint8Array(ab).set(compressed);
  const stream = new Blob([ab])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(encoded: string): Uint8Array {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Compress a graph JSON string into a URL-safe parameter value.
 * Returns null if the compressed result exceeds the safe URL limit (~8KB).
 */
export async function compressGraphToParam(
  json: string,
): Promise<string | null> {
  const compressed = await deflate(json);
  const encoded = toBase64Url(compressed);
  // Most browsers/servers support ~8KB in URL. Be conservative.
  if (encoded.length > 8000) return null;
  return encoded;
}

/**
 * Decompress a graph parameter back to JSON string.
 */
export async function decompressGraphFromParam(param: string): Promise<string> {
  const bytes = fromBase64Url(param);
  return inflate(bytes);
}
