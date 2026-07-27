import { isDeepStrictEqual } from 'node:util';

import type { SigningMethodValue } from '@moltnet/database';
import { VERIFICATION_METHOD } from '@moltnet/models';

import type { SigningServiceDeps } from './signing-service.types.js';
import { SigningServiceError } from './signing-service-error.js';

export type SigningChallengeOperation =
  | 'credential-registration'
  | 'signing-request';

export interface ValidateSigningChallengeInput {
  operation: SigningChallengeOperation;
  resourceId: string;
  challenge: SigningMethodValue;
}

function invalidChallenge(): never {
  throw new SigningServiceError('not_found', 'Signing challenge is not valid');
}

export function createSigningChallengeValidationService(
  deps: SigningServiceDeps,
) {
  const now = deps.now ?? (() => new Date());

  return {
    async validateChallenge(
      input: ValidateSigningChallengeInput,
    ): Promise<{ valid: true }> {
      if (
        input.challenge.verificationMethod !==
        VERIFICATION_METHOD.HumanHardwarePreviewSign
      ) {
        invalidChallenge();
      }

      if (input.operation === 'credential-registration') {
        const registration =
          await deps.signingCredentialRepository.findRegistrationById(
            input.resourceId,
          );
        if (
          !registration ||
          registration.verificationMethod !==
            VERIFICATION_METHOD.HumanHardwarePreviewSign ||
          registration.consumedAt !== null ||
          registration.expiresAt.getTime() <= now().getTime() ||
          !isDeepStrictEqual(registration.challenge, input.challenge)
        ) {
          invalidChallenge();
        }
        return { valid: true };
      }

      const request = await deps.signingRequestRepository.findById(
        input.resourceId,
      );
      if (
        !request ||
        request.verificationMethod !==
          VERIFICATION_METHOD.HumanHardwarePreviewSign ||
        request.status !== 'claimed' ||
        request.expiresAt.getTime() <= now().getTime() ||
        !request.claimedByHumanId ||
        !request.signingCredentialId ||
        !request.teamId ||
        !request.challenge ||
        !isDeepStrictEqual(request.challenge, input.challenge)
      ) {
        invalidChallenge();
      }

      const credential =
        await deps.signingCredentialRepository.findActiveCompatible({
          id: request.signingCredentialId,
          ownerHumanId: request.claimedByHumanId,
          teamId: request.teamId,
          verificationMethod: request.verificationMethod,
        });
      if (!credential) {
        invalidChallenge();
      }
      return { valid: true };
    },
  };
}
