import { createSigningChallengeValidationService } from './signing-challenge-validation.service.js';
import { createSigningCredentialService } from './signing-credential.service.js';
import { createSigningRequestService } from './signing-request.service.js';
import type { SigningServiceDeps } from './signing-service.types.js';

export function createSigningService(deps: SigningServiceDeps) {
  return {
    challengeValidation: createSigningChallengeValidationService(deps),
    credentials: createSigningCredentialService(deps),
    requests: createSigningRequestService(deps),
  };
}

export type SigningService = ReturnType<typeof createSigningService>;
