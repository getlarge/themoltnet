import { isAbsolute, relative } from 'node:path';

/**
 * Check containment for already-resolved lexical or real paths.
 *
 * Callers that accept untrusted paths must resolve/realpath at their I/O
 * boundary first; keeping the platform-specific relative-path rule here avoids
 * subtly different `..` and absolute-path handling across runtime cleanup,
 * session sync, and artifact staging.
 */
export function isResolvedPathInsideRoot(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
