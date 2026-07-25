import {
  type SigningMethodDriver,
  type SigningMethodJson,
  SigningReceiptInvalidError,
  VERIFICATION_METHOD,
} from '@moltnet/signing-workflows';

const TEST_VERIFICATION_METHOD = VERIFICATION_METHOD.HumanHardwarePreviewSign;

function jsonRecord(
  value: SigningMethodJson,
): Record<string, SigningMethodJson> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new SigningReceiptInvalidError();
  }
  return value;
}

/**
 * Deterministic no-crypto adapter enabled only by the e2e Compose stack.
 * It proves the driver lifecycle without implementing any hardware protocol.
 */
export function createTestSigningMethodDriver(): SigningMethodDriver {
  return {
    verificationMethod: TEST_VERIFICATION_METHOD,

    async verify() {
      return false;
    },

    async prepareClaim(input) {
      const response = `test-only:${input.requestId}:${input.credentialId}`;
      return {
        challenge: {
          verificationMethod: TEST_VERIFICATION_METHOD,
          response,
        },
        verifierState: { response },
      };
    },

    async verifyReceipt(input) {
      const state = jsonRecord(input.verifierState);
      const expected = state['response'];
      if (
        typeof expected !== 'string' ||
        input.receipt['response'] !== expected
      ) {
        throw new SigningReceiptInvalidError();
      }
      return {
        verificationMethod: TEST_VERIFICATION_METHOD,
        credentialId: input.credentialId,
        proofHash: `test-only:${input.requestId}:${input.credentialId}`,
      };
    },
  };
}
