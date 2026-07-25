import { VERIFICATION_METHOD } from '@moltnet/signing-workflows';
import { describe, expect, it } from 'vitest';

import { createTestSigningMethodDriver } from '../src/test-signing-method-driver.js';

describe('test signing method driver', () => {
  it('prepares and verifies a method-discriminated receipt', async () => {
    const driver = createTestSigningMethodDriver();
    const prepared = await driver.prepareClaim({
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      requestId: 'request-id',
      credentialId: 'credential-id',
      signingPayload: 'payload',
    });

    const evidence = await driver.verifyReceipt({
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      requestId: 'request-id',
      credentialId: 'credential-id',
      signingPayload: 'payload',
      verifierState: prepared.verifierState,
      receipt: {
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        response: 'test-only:request-id:credential-id',
      },
    });

    expect(evidence).toEqual({
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      credentialId: 'credential-id',
      proofHash: 'test-only:request-id:credential-id',
    });
  });

  it('rejects an invalid receipt with a transport-neutral error code', async () => {
    const driver = createTestSigningMethodDriver();

    await expect(
      driver.verifyReceipt({
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        requestId: 'request-id',
        credentialId: 'credential-id',
        signingPayload: 'payload',
        verifierState: { response: 'expected' },
        receipt: {
          verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
          response: 'wrong',
        },
      }),
    ).rejects.toMatchObject({ code: 'receipt_invalid' });
  });
});
