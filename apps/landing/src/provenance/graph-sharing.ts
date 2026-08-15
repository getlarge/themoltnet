/**
 * Compress/decompress provenance graph JSON for URL sharing.
 *
 * Uses DecompressionStream/CompressionStream (available in all modern browsers)
 * with deflate-raw encoding, then base64url-encodes the result.
 *
 * Falls back to plain base64url when streaming compression APIs are unavailable
 * (e.g. test environments like jsdom/happy-dom).
 */

import { MAX_PROVENANCE_INPUT_BYTES } from './parse-graph';

function hasStreamingCompression(): boolean {
  try {
    return (
      typeof CompressionStream !== 'undefined' &&
      typeof Blob !== 'undefined' &&
      typeof Blob.prototype.stream === 'function'
    );
  } catch {
    return false;
  }
}

async function deflate(input: string): Promise<Uint8Array | null> {
  if (!hasStreamingCompression()) return null;
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
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let decoded = '';
  let totalBytes = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_PROVENANCE_INPUT_BYTES) {
      await reader.cancel();
      throw new Error('Shared provenance graph exceeds the 512 KB limit');
    }
    decoded += decoder.decode(value, { stream: true });
  }

  return decoded + decoder.decode();
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
 * Returns null if compression is unavailable or the result exceeds ~8KB.
 */
export async function compressGraphToParam(
  json: string,
): Promise<string | null> {
  const compressed = await deflate(json);
  if (!compressed) return null;
  const encoded = toBase64Url(compressed);
  // Most browsers/servers support ~8KB in URL. Be conservative.
  if (encoded.length > 8000) return null;
  return encoded;
}

/**
 * Decompress a graph parameter back to JSON string.
 */
export async function decompressGraphFromParam(param: string): Promise<string> {
  if (param.length > 8_000) {
    throw new Error('Shared provenance link exceeds the supported size');
  }
  const bytes = fromBase64Url(param);
  return inflate(bytes);
}
