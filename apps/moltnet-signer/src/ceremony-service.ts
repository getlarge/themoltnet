import { createHash, timingSafeEqual } from 'node:crypto';

import { canonicalJsonBytes } from '@moltnet/crypto-service';
import {
  type SignerCeremony,
  type SignerCeremonyRequest,
  SignerCeremonyRequestSchema,
  type SignerCeremonyResult,
  type SignerPreviewSignChallengeValue,
  type SignerPreviewSignPublicMaterial,
  signerProtocolSchemaContext,
  type SignerSession,
} from '@moltnet/models';
import type { CoseEc2PublicKey } from '@themoltnet/yubikey-preview-sign';
import { Value } from 'typebox/value';

const SESSION_TTL_MS = 10 * 60 * 1000;
const CEREMONY_TTL_MS = 5 * 60 * 1000;
const PREVIEW_SIGN_AUDIENCE = 'moltnet:preview-sign';
const PREVIEW_SIGN_METHOD = 'human-hardware-previewsign';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type ChallengeOperation = 'credential-registration' | 'signing-request';

interface PreviewSignEnvelope {
  audience: typeof PREVIEW_SIGN_AUDIENCE;
  claimantId: string;
  credentialId: string;
  expiresAt: string;
  nonce: string;
  operation: ChallengeOperation;
  publicMaterialHash: string;
  purpose: string;
  requestId: string;
  signingPayload: string;
  teamId: string;
  verificationMethod: typeof PREVIEW_SIGN_METHOD;
  version: 1;
}

export interface SignerDevice {
  enroll(label: string): Promise<SignerPreviewSignPublicMaterial>;
  signPreparedDigest(input: {
    digest: Uint8Array;
    additionalArguments: Uint8Array;
    outerCredentialId: Uint8Array;
    outerPublicKey: CoseEc2PublicKey;
    previewKeyHandle: Uint8Array;
  }): Promise<Uint8Array>;
}

export interface ChallengeValidationInput {
  apiUrl: string;
  operation: ChallengeOperation;
  resourceId: string;
  challenge: SignerPreviewSignChallengeValue;
}

export interface SignerCeremonyServiceOptions {
  allowedOrigins: string[];
  apiUrl: string;
  approvalBaseUrl?: string;
  device: SignerDevice;
  validateChallenge(input: ChallengeValidationInput): Promise<{ valid: true }>;
  now?: () => Date;
  randomToken: () => string;
}

export interface SignerApprovalDisplay {
  action: string;
  audience?: string;
  claimantId?: string;
  expiresAt: string;
  operation: SignerCeremonyRequest['operation'];
  resourceId?: string;
  signingPayload?: string;
  teamId: string;
  verificationMethod: typeof PREVIEW_SIGN_METHOD;
}

interface SessionState {
  origin: string;
  expiresAt: Date;
}

interface CeremonyState {
  id: string;
  origin: string;
  sessionToken: string;
  request: SignerCeremonyRequest;
  approval: SignerApprovalDisplay;
  confirmationToken?: string;
  expiresAt: Date;
  result: SignerCeremonyResult;
  confirmed: boolean;
}

export type SignerCeremonyErrorCode =
  | 'origin_not_allowed'
  | 'session_invalid'
  | 'ceremony_invalid'
  | 'ceremony_expired'
  | 'challenge_invalid'
  | 'confirmation_invalid'
  | 'ceremony_completed'
  | 'device_failed';

export class SignerCeremonyError extends Error {
  constructor(
    public readonly code: SignerCeremonyErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SignerCeremonyError';
  }
}

export class SignerCeremonyService {
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly sessions = new Map<string, SessionState>();
  private readonly ceremonies = new Map<string, CeremonyState>();
  private readonly now: () => Date;
  private readonly approvalBaseUrl: string;

  constructor(private readonly options: SignerCeremonyServiceOptions) {
    this.allowedOrigins = new Set(
      options.allowedOrigins.map((origin) => normalizedOrigin(origin)),
    );
    this.now = options.now ?? (() => new Date());
    this.approvalBaseUrl = options.approvalBaseUrl ?? 'http://127.0.0.1:17373';
  }

  createSession(input: { origin: string }): SignerSession {
    const origin = this.requireOrigin(input.origin);
    const token = this.uniqueToken(this.sessions);
    const expiresAt = new Date(this.now().getTime() + SESSION_TTL_MS);
    this.sessions.set(token, { origin, expiresAt });
    return { version: 1, token, expiresAt: expiresAt.toISOString() };
  }

  assertOrigin(origin: string): void {
    this.requireOrigin(origin);
  }

  async createCeremony(input: {
    origin: string;
    sessionToken: string;
    request: SignerCeremonyRequest;
  }): Promise<SignerCeremony> {
    const origin = this.requireOrigin(input.origin);
    this.requireSession(input.sessionToken, origin);
    if (
      !Value.Check(
        signerProtocolSchemaContext,
        SignerCeremonyRequestSchema,
        input.request,
      )
    ) {
      throw new SignerCeremonyError(
        'ceremony_invalid',
        'Ceremony request is invalid',
      );
    }

    const now = this.now();
    let approval: SignerApprovalDisplay;
    let expiresAt = new Date(now.getTime() + CEREMONY_TTL_MS);
    if (input.request.operation === 'credential-enrollment') {
      approval = {
        action: `Enroll hardware signing credential “${input.request.label}”`,
        expiresAt: expiresAt.toISOString(),
        operation: input.request.operation,
        teamId: input.request.teamId,
        verificationMethod: PREVIEW_SIGN_METHOD,
      };
    } else {
      const envelope = parseChallenge(
        input.request.operation,
        input.request.resourceId,
        input.request.challenge,
        now,
      );
      await this.options.validateChallenge({
        apiUrl: this.options.apiUrl,
        operation: input.request.operation,
        resourceId: input.request.resourceId,
        challenge: input.request.challenge,
      });
      expiresAt = earliestDate(expiresAt, new Date(envelope.expiresAt));
      approval = {
        action: envelope.purpose,
        audience: envelope.audience,
        claimantId: envelope.claimantId,
        expiresAt: envelope.expiresAt,
        operation: envelope.operation,
        resourceId: envelope.requestId,
        signingPayload: envelope.signingPayload,
        teamId: envelope.teamId,
        verificationMethod: envelope.verificationMethod,
      };
    }

    const id = this.uniqueToken(this.ceremonies);
    const confirmationToken = this.options.randomToken();
    const state: CeremonyState = {
      id,
      origin,
      sessionToken: input.sessionToken,
      request: input.request,
      approval,
      confirmationToken,
      expiresAt,
      result: {
        version: 1,
        status: 'pending',
        operation: input.request.operation,
      },
      confirmed: false,
    };
    this.ceremonies.set(id, state);
    return {
      version: 1,
      id,
      operation: input.request.operation,
      approvalUrl: `${this.approvalBaseUrl}/ceremonies/${encodeURIComponent(id)}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  getApproval(ceremonyId: string): {
    display: SignerApprovalDisplay;
    confirmationToken: string;
  } {
    const ceremony = this.requireCeremony(ceremonyId);
    this.requireCeremonyFresh(ceremony);
    if (!ceremony.confirmationToken || ceremony.confirmed) {
      throw new SignerCeremonyError(
        'ceremony_completed',
        'Ceremony has already been confirmed',
      );
    }
    return {
      display: structuredClone(ceremony.approval),
      confirmationToken: ceremony.confirmationToken,
    };
  }

  async confirmCeremony(input: {
    ceremonyId: string;
    confirmationToken: string;
  }): Promise<void> {
    const ceremony = this.requireCeremony(input.ceremonyId);
    this.requireCeremonyFresh(ceremony);
    if (
      ceremony.confirmed ||
      !ceremony.confirmationToken ||
      !secretEquals(ceremony.confirmationToken, input.confirmationToken)
    ) {
      throw new SignerCeremonyError(
        'confirmation_invalid',
        'Confirmation is invalid',
      );
    }

    ceremony.confirmed = true;
    ceremony.confirmationToken = undefined;
    try {
      if (ceremony.request.operation === 'credential-enrollment') {
        const publicMaterial = await this.options.device.enroll(
          ceremony.request.label,
        );
        ceremony.result = {
          version: 1,
          status: 'completed',
          operation: 'credential-enrollment',
          publicMaterial,
        };
        return;
      }

      const envelope = parseChallenge(
        ceremony.request.operation,
        ceremony.request.resourceId,
        ceremony.request.challenge,
        this.now(),
      );
      await this.options.validateChallenge({
        apiUrl: this.options.apiUrl,
        operation: ceremony.request.operation,
        resourceId: ceremony.request.resourceId,
        challenge: ceremony.request.challenge,
      });
      const challenge = ceremony.request.challenge.value;
      const signature = await this.options.device.signPreparedDigest({
        digest: strictBase64Url(challenge.digest, 'digest', 32),
        additionalArguments: strictBase64Url(
          challenge.additionalArguments,
          'additionalArguments',
        ),
        outerCredentialId: strictBase64Url(
          challenge.outerCredentialId,
          'outerCredentialId',
        ),
        outerPublicKey: challenge.outerPublicKey,
        previewKeyHandle: strictBase64Url(
          challenge.previewKeyHandle,
          'previewKeyHandle',
        ),
      });
      if (
        signature.length < 8 ||
        signature.length > 72 ||
        signature[0] !== 0x30
      ) {
        throw new SignerCeremonyError(
          'device_failed',
          'Authenticator returned an invalid signature',
        );
      }
      ceremony.result = {
        version: 1,
        status: 'completed',
        operation: envelope.operation,
        receipt: {
          verificationMethod: PREVIEW_SIGN_METHOD,
          value: {
            version: 1,
            signature: Buffer.from(signature).toString('base64url'),
          },
        },
      };
    } catch (error) {
      const signerError =
        error instanceof SignerCeremonyError
          ? error
          : new SignerCeremonyError(
              'device_failed',
              'Signing ceremony failed',
              { cause: error },
            );
      ceremony.result = {
        version: 1,
        status: 'failed',
        operation: ceremony.request.operation,
        code: signerError.code,
        message: signerError.message,
      };
      throw signerError;
    }
  }

  getResult(input: {
    ceremonyId: string;
    origin: string;
    sessionToken: string;
  }): SignerCeremonyResult {
    const origin = this.requireOrigin(input.origin);
    this.requireSession(input.sessionToken, origin);
    const ceremony = this.requireCeremony(input.ceremonyId);
    if (
      ceremony.origin !== origin ||
      !secretEquals(ceremony.sessionToken, input.sessionToken)
    ) {
      throw new SignerCeremonyError(
        'ceremony_invalid',
        'Ceremony is not available',
      );
    }
    if (
      ceremony.result.status === 'pending' &&
      ceremony.expiresAt.getTime() <= this.now().getTime()
    ) {
      ceremony.result = {
        version: 1,
        status: 'failed',
        operation: ceremony.request.operation,
        code: 'ceremony_expired',
        message: 'Ceremony has expired',
      };
    }
    return structuredClone(ceremony.result);
  }

  private requireOrigin(value: string): string {
    let origin: string;
    try {
      origin = normalizedOrigin(value);
    } catch {
      throw new SignerCeremonyError(
        'origin_not_allowed',
        'Origin is not allowed',
      );
    }
    if (!this.allowedOrigins.has(origin)) {
      throw new SignerCeremonyError(
        'origin_not_allowed',
        'Origin is not allowed',
      );
    }
    return origin;
  }

  private requireSession(token: string, origin: string): SessionState {
    const session = this.sessions.get(token);
    if (
      !session ||
      session.origin !== origin ||
      session.expiresAt.getTime() <= this.now().getTime()
    ) {
      if (session) this.sessions.delete(token);
      throw new SignerCeremonyError(
        'session_invalid',
        'Signer session is invalid',
      );
    }
    return session;
  }

  private requireCeremony(id: string): CeremonyState {
    const ceremony = this.ceremonies.get(id);
    if (!ceremony) {
      throw new SignerCeremonyError(
        'ceremony_invalid',
        'Ceremony is not available',
      );
    }
    return ceremony;
  }

  private requireCeremonyFresh(ceremony: CeremonyState): void {
    if (ceremony.expiresAt.getTime() <= this.now().getTime()) {
      throw new SignerCeremonyError('ceremony_expired', 'Ceremony has expired');
    }
  }

  private uniqueToken<T>(map: ReadonlyMap<string, T>): string {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const token = this.options.randomToken();
      if (token.length >= 8 && !map.has(token)) return token;
    }
    throw new SignerCeremonyError(
      'ceremony_invalid',
      'Unable to allocate a ceremony token',
    );
  }
}

function normalizedOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.origin !== value ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && isLoopback(url.hostname)))
  ) {
    throw new Error('Invalid origin');
  }
  return url.origin;
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  );
}

function strictBase64Url(
  value: string,
  label: string,
  exactBytes?: number,
): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new SignerCeremonyError(
      'challenge_invalid',
      `${label} is not canonical base64url`,
    );
  }
  const decoded = Buffer.from(value, 'base64url');
  if (
    decoded.toString('base64url') !== value ||
    (exactBytes !== undefined && decoded.length !== exactBytes)
  ) {
    throw new SignerCeremonyError(
      'challenge_invalid',
      `${label} is not canonical base64url`,
    );
  }
  return decoded;
}

function parseChallenge(
  operation: ChallengeOperation,
  resourceId: string,
  challengeValue: SignerPreviewSignChallengeValue,
  now: Date,
): PreviewSignEnvelope {
  const challenge = challengeValue.value;
  if (
    challengeValue.verificationMethod !== PREVIEW_SIGN_METHOD ||
    challenge.verificationMethod !== PREVIEW_SIGN_METHOD
  ) {
    throw new SignerCeremonyError(
      'challenge_invalid',
      'Verification method does not match',
    );
  }
  const envelopeBytes = strictBase64Url(challenge.envelope, 'envelope');
  const digest = strictBase64Url(challenge.digest, 'digest', 32);
  const computedDigest = createHash('sha256').update(envelopeBytes).digest();
  if (!timingSafeEqual(digest, computedDigest)) {
    throw new SignerCeremonyError(
      'challenge_invalid',
      'Envelope digest does not match',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(envelopeBytes),
    );
  } catch {
    throw new SignerCeremonyError(
      'challenge_invalid',
      'Envelope is not valid UTF-8 JSON',
    );
  }
  if (!isRecord(parsed)) {
    throw new SignerCeremonyError(
      'challenge_invalid',
      'Envelope must be an object',
    );
  }
  const expectedKeys = [
    'audience',
    'claimantId',
    'credentialId',
    'expiresAt',
    'nonce',
    'operation',
    'publicMaterialHash',
    'purpose',
    'requestId',
    'signingPayload',
    'teamId',
    'verificationMethod',
    'version',
  ];
  if (
    Object.keys(parsed).length !== expectedKeys.length ||
    !expectedKeys.every((key) => Object.hasOwn(parsed, key)) ||
    !Buffer.from(canonicalJsonBytes(parsed)).equals(envelopeBytes)
  ) {
    throw new SignerCeremonyError(
      'challenge_invalid',
      'Envelope is not canonical or contains unsupported fields',
    );
  }
  if (
    parsed['version'] !== 1 ||
    parsed['audience'] !== PREVIEW_SIGN_AUDIENCE ||
    parsed['verificationMethod'] !== PREVIEW_SIGN_METHOD ||
    parsed['operation'] !== operation ||
    parsed['requestId'] !== resourceId
  ) {
    throw new SignerCeremonyError(
      'challenge_invalid',
      'Envelope binding does not match the ceremony',
    );
  }
  for (const key of expectedKeys.filter((key) => key !== 'version')) {
    if (typeof parsed[key] !== 'string' || parsed[key].length === 0) {
      throw new SignerCeremonyError(
        'challenge_invalid',
        `Envelope ${key} is invalid`,
      );
    }
  }
  strictBase64Url(
    parsed['publicMaterialHash'] as string,
    'publicMaterialHash',
    32,
  );
  for (const key of [
    'claimantId',
    'credentialId',
    'nonce',
    'requestId',
    'teamId',
  ]) {
    if (!UUID_PATTERN.test(parsed[key] as string)) {
      throw new SignerCeremonyError(
        'challenge_invalid',
        `Envelope ${key} is invalid`,
      );
    }
  }
  const expiresAt = new Date(parsed['expiresAt'] as string);
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.toISOString() !== parsed['expiresAt'] ||
    expiresAt.getTime() <= now.getTime()
  ) {
    throw new SignerCeremonyError('challenge_invalid', 'Envelope has expired');
  }
  return parsed as unknown as PreviewSignEnvelope;
}

function earliestDate(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function secretEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}
