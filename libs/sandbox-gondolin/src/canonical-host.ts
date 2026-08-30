import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

const DECIMAL_IPV4_COMPONENTS = /^\d+(?:\.\d+){0,3}$/;
const NON_DECIMAL_IPV4 =
  /^(?:0x[\da-f]+|0[0-7]+)(?:\.(?:0x[\da-f]+|0[0-7]+|\d+)){0,3}$/i;

function stripTrailingDots(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 46) end -= 1;
  return value.slice(0, end);
}

function rejectAlternateNumericAddress(hostname: string): void {
  if (
    isIP(hostname) === 0 &&
    (DECIMAL_IPV4_COMPONENTS.test(hostname) ||
      NON_DECIMAL_IPV4.test(hostname) ||
      /^\d+$/.test(hostname))
  ) {
    throw new Error('alternate numeric IP forms are not admitted');
  }
}

/** Canonicalize one concrete DNS name or IP literal for policy comparison. */
export function canonicalizeHostname(input: string): string {
  const withoutBrackets = input.trim().replace(/^\[|\]$/g, '');
  const withoutTrailingDot = stripTrailingDots(withoutBrackets);
  if (!withoutTrailingDot) throw new Error('hostname is required');

  rejectAlternateNumericAddress(withoutTrailingDot);
  const ipVersion = isIP(withoutTrailingDot);
  if (ipVersion === 4) return withoutTrailingDot;
  if (ipVersion === 6) {
    const normalized = new URL(`http://[${withoutTrailingDot}]/`).hostname;
    return normalized.slice(1, -1);
  }
  if (/[\s/:@?#[\]]/.test(withoutTrailingDot)) {
    throw new Error('invalid hostname');
  }

  const ascii = domainToASCII(withoutTrailingDot.toLowerCase());
  if (!ascii || ascii.length > 253) throw new Error('invalid hostname');
  return ascii;
}

/**
 * Credential destinations deliberately support only exact hosts, a global
 * wildcard, or a leading one-label wildcard. Arbitrary globs are too
 * ambiguous for a secret-delivery boundary.
 */
export function canonicalizeCredentialHostPattern(input: string): string {
  const pattern = input.trim();
  if (pattern === '*') return pattern;
  if (pattern.startsWith('*.') && pattern.indexOf('*', 1) === -1) {
    return `*.${canonicalizeHostname(pattern.slice(2))}`;
  }
  if (pattern.includes('*')) {
    throw new Error('credential host patterns allow only a leading *.');
  }
  return canonicalizeHostname(pattern);
}

export function credentialHostMatches(
  hostnameInput: string,
  patternInput: string,
): boolean {
  const hostname = canonicalizeHostname(hostnameInput);
  const pattern = canonicalizeCredentialHostPattern(patternInput);
  if (pattern === '*') return true;
  if (!pattern.startsWith('*.')) return hostname === pattern;

  const suffix = pattern.slice(2);
  if (!hostname.endsWith(`.${suffix}`)) return false;
  const prefix = hostname.slice(0, -(suffix.length + 1));
  return prefix.length > 0 && !prefix.includes('.');
}

/** Keep Gondolin's wider network glob syntax separate from secret patterns. */
export function normalizeNetworkHostPattern(input: string): string {
  const pattern = input.trim();
  if (pattern === '*') return pattern;
  if (!pattern.includes('*')) return canonicalizeHostname(pattern);

  const normalized = stripTrailingDots(pattern.toLowerCase());
  if (
    normalized === '' ||
    normalized.includes('://') ||
    normalized.includes('/') ||
    normalized.includes(':') ||
    /\s/.test(normalized)
  ) {
    throw new Error('invalid network host pattern');
  }
  return normalized;
}

function networkPatternMatchesHostname(
  networkPatternInput: string,
  hostnameInput: string,
): boolean {
  const networkPattern = normalizeNetworkHostPattern(networkPatternInput);
  const hostname = canonicalizeHostname(hostnameInput);
  const expression = networkPattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${expression}$`, 'i').test(hostname);
}

/** Prove that a network grant covers a narrower credential destination. */
export function networkPatternCoversCredentialPattern(
  networkPatternInput: string,
  credentialPatternInput: string,
): boolean {
  const networkPattern = normalizeNetworkHostPattern(networkPatternInput);
  const credentialPattern = canonicalizeCredentialHostPattern(
    credentialPatternInput,
  );
  if (networkPattern === '*') return true;
  if (credentialPattern.includes('*')) {
    return networkPattern === credentialPattern;
  }
  return networkPatternMatchesHostname(networkPattern, credentialPattern);
}
