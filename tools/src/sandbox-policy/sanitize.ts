import { homedir } from 'node:os';

import { stableJson, validateProbeRun } from './evidence.js';
import type { SandboxProbeRun } from './types.js';

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
const REDACTED_SENTINEL = '<redacted synthetic credential>';

interface SanitizationReport {
  sensitiveValueHits: number;
}

class SensitiveValueLeakError extends Error {
  constructor() {
    super('refusing to persist a synthetic credential sentinel');
    this.name = 'SensitiveValueLeakError';
  }
}

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

function sanitizeString(
  input: string,
  options: SanitizeOptions,
  report?: SanitizationReport,
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
    for (const form of sensitiveRepresentations(sensitive)) {
      if (!output.includes(form)) continue;
      if (!report) throw new SensitiveValueLeakError();
      const hits = output.split(form).length - 1;
      report.sensitiveValueHits += hits;
      output = replaceAllLiteral(output, form, REDACTED_SENTINEL);
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

function sanitizeValue(
  value: unknown,
  options: SanitizeOptions,
  report?: SanitizationReport,
): unknown {
  if (typeof value === 'string') return sanitizeString(value, options, report);
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, options, report));
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('refusing to persist a non-plain object');
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        sanitizeString(key, options, report),
        sanitizeValue(child, options, report),
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
  onSensitiveValue?: () => void,
): string {
  try {
    return sanitizeString(input, options);
  } catch (error) {
    if (error instanceof SensitiveValueLeakError) onSensitiveValue?.();
    return REDACTED_DIAGNOSTIC;
  }
}

export function sanitizeForPersistence(
  value: unknown,
  options: SanitizeOptions = {},
): string {
  return stableJson(sanitizeValue(value, options));
}

/**
 * Validate the complete value-free run before promoting the persistence
 * scenario. The adapter cannot prove this control while it is still producing
 * evidence; the persistence boundary is the first place with the whole value.
 */
export function sanitizeProbeRunForPersistence(
  run: SandboxProbeRun,
  options: SanitizeOptions = {},
): string {
  const report: SanitizationReport = { sensitiveValueHits: 0 };
  const persistedRun = sanitizeValue(
    structuredClone(run),
    options,
    report,
  ) as SandboxProbeRun;
  const evidenceLeak = persistedRun.controls.find(
    (control) => control.scenarioId === 'credential.evidence-leak',
  );
  if (evidenceLeak) {
    const registeredSensitiveValues = options.sensitiveValues?.length ?? 0;
    const observedLeaks =
      report.sensitiveValueHits + persistedRun.sensitiveDiagnosticRedactions;
    const passed = registeredSensitiveValues > 0 && observedLeaks === 0;
    evidenceLeak.state = passed ? 'enforced' : 'failed-open';
    delete evidenceLeak.unsupportedKind;
    evidenceLeak.basis = 'harness-observed';
    evidenceLeak.enforcementLocus = ['research-harness'];
    evidenceLeak.oracle = {
      attestedBy: 'harness',
      kind: 'persisted-sensitive-value-count',
      expected: { registeredSensitiveValues: 'at-least-one', leakHits: 0 },
      observed: { registeredSensitiveValues, leakHits: observedLeaks },
      passed,
    };
    evidenceLeak.reasonCode = passed
      ? 'value_free_evidence_only'
      : 'evidence_persistence_validation_failed';
  }
  const validationViolations = validateProbeRun(persistedRun);
  for (const violation of validationViolations) {
    if (
      !persistedRun.violations.some(
        (existing) =>
          existing.code === violation.code &&
          existing.scenarioId === violation.scenarioId &&
          existing.message === violation.message,
      )
    ) {
      persistedRun.violations.push(violation);
    }
  }
  return stableJson(persistedRun);
}
