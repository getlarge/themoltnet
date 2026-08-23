import { homedir } from 'node:os';

import { stableJson } from './evidence.js';

export interface SanitizeOptions {
  machinePaths?: string[];
  replacements?: Record<string, string>;
  sensitiveValues?: string[];
}

const PRIVATE_KEY_PATTERN =
  /-----BEGIN (?:ENCRYPTED )?(?:EC |RSA |OPENSSH )?PRIVATE KEY-----/i;
const TOKEN_PATTERNS = [
  /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]{16,}\b/i,
  /\bgh[pousr]_[a-z0-9_]{20,}\b/i,
  /\bgithub_pat_[a-z0-9_]{20,}\b/i,
  /\bsk-[a-z0-9_-]{16,}\b/i,
  /\bory_pat_[a-z0-9_-]{16,}\b/i,
  /\beyJ[a-z0-9_-]{20,}\.[a-z0-9_-]{20,}\.[a-z0-9_-]{20,}\b/i,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bxox[baprs]-[a-z0-9-]{16,}\b/i,
] as const;
const POSIX_HOME_PATTERN =
  /\/(?:Users|home)\/[^/\s"']+(?:\/|(?=$|[\s"',)}\]]))/i;
const WINDOWS_HOME_PATTERN =
  /[A-Za-z]:\\Users\\[^\\\s"']+(?:\\|(?=$|[\s"',)}\]]))/i;
const REDACTED_DIAGNOSTIC = '<redacted sensitive diagnostic>';

function replaceAllLiteral(value: string, from: string, to: string): string {
  return from === '' ? value : value.split(from).join(to);
}

function sensitiveRepresentations(value: string): string[] {
  if (value === '') return [];
  const jsonEncoded = JSON.stringify(value).slice(1, -1);
  const base64 = Buffer.from(value, 'utf8').toString('base64');
  const base64url = Buffer.from(value, 'utf8').toString('base64url');
  return [
    ...new Set([
      value,
      jsonEncoded,
      base64,
      base64url,
      encodeURIComponent(value),
    ]),
  ];
}

function sanitizeString(input: string, options: SanitizeOptions): string {
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
    if (
      sensitiveRepresentations(sensitive).some((form) => output.includes(form))
    ) {
      throw new Error('refusing to persist a synthetic credential sentinel');
    }
  }
  if (PRIVATE_KEY_PATTERN.test(output)) {
    throw new Error('refusing to persist private-key material');
  }
  if (TOKEN_PATTERNS.some((pattern) => pattern.test(output))) {
    throw new Error('refusing to persist token-like material');
  }
  if (POSIX_HOME_PATTERN.test(output) || WINDOWS_HOME_PATTERN.test(output)) {
    throw new Error('refusing to persist an absolute host path');
  }
  return output;
}

function sanitizeValue(value: unknown, options: SanitizeOptions): unknown {
  if (typeof value === 'string') return sanitizeString(value, options);
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, options));
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('refusing to persist a non-plain object');
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        sanitizeValue(child, options),
      ]),
    );
  }
  throw new Error(`refusing to persist unsupported ${typeof value} value`);
}

export function sanitizeText(
  input: string,
  options: SanitizeOptions = {},
): string {
  return sanitizeString(input, options);
}

export function sanitizeDiagnostic(
  input: string,
  options: SanitizeOptions = {},
): string {
  try {
    return sanitizeString(input, options);
  } catch {
    return REDACTED_DIAGNOSTIC;
  }
}

export function sanitizeForPersistence(
  value: unknown,
  options: SanitizeOptions = {},
): string {
  return stableJson(sanitizeValue(value, options));
}
