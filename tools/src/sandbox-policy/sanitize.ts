import { homedir } from 'node:os';

import { stableJson } from './evidence.js';

export interface SanitizeOptions {
  machinePaths?: string[];
  replacements?: Record<string, string>;
  sensitiveValues?: string[];
}

const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const TOKEN_PATTERN = /(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,})/;
const HOST_PATH_PATTERN =
  /(?:\/Users\/[^/\s"']+\/|\/home\/[^/\s"']+\/|[A-Za-z]:\\Users\\[^\\\s"']+\\)/;

function replaceAllLiteral(value: string, from: string, to: string): string {
  return from === '' ? value : value.split(from).join(to);
}

export function sanitizeText(
  input: string,
  options: SanitizeOptions = {},
): string {
  let output = input;
  const machinePaths = new Set([homedir(), ...(options.machinePaths ?? [])]);
  for (const machinePath of [...machinePaths].sort(
    (left, right) => right.length - left.length,
  )) {
    output = replaceAllLiteral(output, machinePath, '$HOST_PATH');
  }
  for (const [from, to] of Object.entries(options.replacements ?? {})) {
    output = replaceAllLiteral(output, from, to);
  }
  for (const sensitive of options.sensitiveValues ?? []) {
    if (sensitive !== '' && output.includes(sensitive)) {
      throw new Error('refusing to persist a synthetic credential sentinel');
    }
  }
  if (PRIVATE_KEY_PATTERN.test(output)) {
    throw new Error('refusing to persist private-key material');
  }
  if (TOKEN_PATTERN.test(output)) {
    throw new Error('refusing to persist token-like material');
  }
  if (HOST_PATH_PATTERN.test(output)) {
    throw new Error('refusing to persist an absolute host path');
  }
  return output;
}

export function sanitizeForPersistence(
  value: unknown,
  options: SanitizeOptions = {},
): string {
  return sanitizeText(stableJson(value), options);
}
