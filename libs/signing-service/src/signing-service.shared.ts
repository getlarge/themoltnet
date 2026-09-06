import { type AuthContext, KetoNamespace } from '@moltnet/auth';
import type { SigningMethodJson } from '@moltnet/signing-workflows';
import {
  SigningCredentialError,
  SigningVerifierNotRegisteredError,
  SigningWorkflowError,
} from '@moltnet/signing-workflows';

import { SigningServiceError } from './signing-service-error.js';

export function asSigningMethodJson(value: unknown): SigningMethodJson {
  return value as SigningMethodJson;
}

export function namespace(actor: AuthContext): KetoNamespace {
  return actor.subjectType === 'human'
    ? KetoNamespace.Human
    : KetoNamespace.Agent;
}

/**
 * The actor's Keto subject: `agents.id` or `humans.id`, per `subjectType`.
 *
 * The counterpart to {@link namespace} — every permission check takes the two
 * together, and they must be derived from the same discriminant. Never the
 * Kratos identity: identities are recreatable, so a subject that moves with
 * one silently detaches the principal from every permission it holds.
 */
export function subjectId(actor: AuthContext): string {
  return actor.subjectType === 'human' ? actor.humanId : actor.agentId;
}

/**
 * The actor as a principal record for creator/owner/actor columns, whose
 * foreign keys target `agents.id` / `humans.id`.
 */
export function actorPrincipal(actor: AuthContext): {
  readonly kind: 'agent' | 'human';
  readonly id: string;
} {
  return { kind: actor.subjectType, id: subjectId(actor) } as const;
}

export function requireHuman(
  actor: AuthContext,
  message = 'A human session is required',
) {
  if (actor.subjectType !== 'human') {
    throw new SigningServiceError('forbidden', message);
  }
  return actor;
}

export function mapWorkflowError(error: unknown): never {
  if (error instanceof SigningCredentialError) {
    const code =
      error.code === 'credential_lifecycle_conflict' ||
      error.code === 'credential_registration_invalid'
        ? 'conflict'
        : 'validation_failed';
    throw new SigningServiceError(code, error.message, { cause: error });
  }
  if (error instanceof SigningVerifierNotRegisteredError) {
    throw new SigningServiceError(
      'validation_failed',
      `No signing verifier is registered for verification method: ${error.verificationMethod}`,
      { cause: error },
    );
  }
  if (error instanceof SigningWorkflowError) {
    throw new SigningServiceError('validation_failed', error.message, {
      cause: error,
    });
  }
  throw error;
}
