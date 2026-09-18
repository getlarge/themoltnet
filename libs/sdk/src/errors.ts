import type { ProblemDetails } from '@moltnet/api-client';

/**
 * One field-level validation error surfaced by the rest-api when a
 * request body fails schema or cross-field validation. Mirrors the
 * server's `ValidationProblemDetails.errors[]` entries.
 */
export interface ValidationError {
  readonly field: string;
  readonly message: string;
}

export class MoltNetError extends Error {
  readonly code: string;
  readonly statusCode?: number;
  readonly detail?: string;
  readonly issuedKeyId?: string;
  /**
   * Populated when the server returned a `VALIDATION_FAILED` problem
   * (status 400) with field-level errors. Empty / undefined for every
   * other problem kind. Proposer scripts surface these to operators so
   * they don't have to re-run with curl to see what was rejected.
   */
  readonly validationErrors?: readonly ValidationError[];

  constructor(
    message: string,
    options: {
      code: string;
      statusCode?: number;
      detail?: string;
      issuedKeyId?: string;
      validationErrors?: readonly ValidationError[];
    },
  ) {
    super(message);
    this.name = 'MoltNetError';
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.detail = options.detail;
    this.issuedKeyId = options.issuedKeyId;
    this.validationErrors = options.validationErrors;
  }
}

export class RegistrationError extends MoltNetError {
  constructor(
    message: string,
    options: { code: string; statusCode: number; detail?: string },
  ) {
    super(message, options);
    this.name = 'RegistrationError';
  }
}

export class NetworkError extends MoltNetError {
  constructor(message: string, options?: { detail?: string }) {
    super(message, {
      code: 'NETWORK_ERROR',
      detail: options?.detail,
    });
    this.name = 'NetworkError';
  }
}

export class AuthenticationError extends MoltNetError {
  constructor(
    message: string,
    options?: { statusCode?: number; detail?: string },
  ) {
    super(message, {
      code: 'AUTH_FAILED',
      statusCode: options?.statusCode,
      detail: options?.detail,
    });
    this.name = 'AuthenticationError';
  }
}

export function problemToError(
  problem: ProblemDetails,
  statusCode: number,
): MoltNetError {
  const title = problem.title ?? 'Request failed';
  const message = problem.detail ? `${title}: ${problem.detail}` : title;
  // The server's VALIDATION_FAILED problems carry a non-standard
  // `errors[]` array (per `apps/rest-api/src/plugins/error-handler.ts`).
  // ProblemDetails on @moltnet/api-client doesn't type it because RFC
  // 7807 doesn't, so we coerce defensively and keep only entries with
  // the expected shape.
  const rawErrors = (problem as unknown as { errors?: unknown }).errors;
  const validationErrors = Array.isArray(rawErrors)
    ? rawErrors.filter(
        (e): e is ValidationError =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as { field?: unknown }).field === 'string' &&
          typeof (e as { message?: unknown }).message === 'string',
      )
    : undefined;
  const conflict = (
    problem as unknown as {
      conflict?: { target?: { resource?: string; keys?: { keyId?: unknown } } };
    }
  ).conflict;
  const issuedKeyId =
    conflict?.target?.resource === 'agent-key' &&
    typeof conflict.target.keys?.keyId === 'string'
      ? conflict.target.keys.keyId
      : undefined;
  return new MoltNetError(message, {
    issuedKeyId,
    code: problem.type ?? problem.code ?? 'UNKNOWN',
    statusCode,
    detail: problem.detail,
    validationErrors,
  });
}

export type RegisterIdentityErrorCode =
  | 'invalid_alias'
  | 'alias_exists'
  | 'provider_unavailable'
  | 'registration_failed'
  | 'registration_incomplete'
  | 'unsupported_credential'
  | 'identity_mismatch';

const NOTHING_REGISTERED_CODES: ReadonlySet<RegisterIdentityErrorCode> =
  new Set([
    'invalid_alias',
    'alias_exists',
    'provider_unavailable',
    'registration_failed',
  ]);

/**
 * Failure of the persisting `register()` in `@themoltnet/sdk/node`.
 *
 * `nothingRegistered` is true when the request was never sent or the server
 * rejected it. `registration_incomplete` means the server may have committed
 * the identity: when `subjectId` is set it did, and `configPath` is set once
 * its config exists. `recoveryCommand` is set only when the CLI can act on
 * that config: the default identity store with secrets in the OS keyring.
 * Without `subjectId` the outcome is unknown; a caller abort also lands here,
 * because the request may already have reached the server.
 * `unsupported_credential` and `identity_mismatch` follow a commit.
 *
 * The identity seed is never deleted once stored, whatever the failure:
 * `seedReference` names where it is kept, because a deleted seed can make a
 * server-side identity permanently unrecoverable.
 */
export class RegisterIdentityError extends MoltNetError {
  override readonly code: RegisterIdentityErrorCode;
  readonly subjectId?: string;
  readonly fingerprint?: string;
  readonly configPath?: string;
  readonly recoveryCommand?: string;
  readonly recoveryPath?: string;
  readonly seedReference?: { provider: string; key: string };

  constructor(
    code: RegisterIdentityErrorCode,
    message: string,
    options: {
      cause?: unknown;
      statusCode?: number;
      detail?: string;
      subjectId?: string;
      fingerprint?: string;
      configPath?: string;
      recoveryCommand?: string;
      recoveryPath?: string;
      seedReference?: { provider: string; key: string };
    } = {},
  ) {
    super(message, {
      code,
      statusCode: options.statusCode,
      detail: options.detail,
    });
    this.name = 'RegisterIdentityError';
    this.code = code;
    this.cause = options.cause;
    this.subjectId = options.subjectId;
    this.fingerprint = options.fingerprint;
    this.configPath = options.configPath;
    this.recoveryCommand = options.recoveryCommand;
    this.recoveryPath = options.recoveryPath;
    this.seedReference = options.seedReference;
  }

  /** True when no identity can exist on the server because of this call. */
  get nothingRegistered(): boolean {
    return NOTHING_REGISTERED_CODES.has(this.code);
  }
}
