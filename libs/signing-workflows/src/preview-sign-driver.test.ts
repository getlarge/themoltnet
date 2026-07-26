import { p256 } from '@noble/curves/nist.js';
import { verifyP256PrehashedSignature } from '@themoltnet/yubikey-preview-sign/protocol';
import serverVector from '@themoltnet/yubikey-preview-sign/vectors/preview-sign-server-v1.json';
import { describe, expect, it, vi } from 'vitest';

import {
  createPreviewSignSigningMethodDriver,
  PREVIEW_SIGN_ALGORITHM,
  PREVIEW_SIGN_CREDENTIAL_TYPE,
  PREVIEW_SIGN_PUBLIC_MATERIAL_VERSION,
  PREVIEW_SIGN_RECEIPT_VERSION,
  type PreviewSignEc2PublicKey,
  type PreviewSignPublicMaterialV1,
} from './preview-sign-driver.js';
import { SigningCredentialError } from './signing-credentials.js';
import {
  type SigningMethodJson,
  VERIFICATION_METHOD,
} from './signing-workflows.js';

const REQUEST_ID = '770e8400-e29b-41d4-a716-446655440002';
const CREDENTIAL_ID = '880e8400-e29b-41d4-a716-446655440003';
const TEAM_ID = '990e8400-e29b-41d4-a716-446655440004';
const HUMAN_ID = 'aa0e8400-e29b-41d4-a716-446655440005';
const NONCE = 'bb0e8400-e29b-41d4-a716-446655440006';
const EXPIRES_AT = '2026-08-01T12:05:00.000Z';
const IKM = Uint8Array.from({ length: 32 }, (_, index) => 0x40 + index);
const BLINDING_SECRET = new Uint8Array(32).fill(7);
const KEM_SECRET = new Uint8Array(32).fill(8);
const OUTER_SECRET = new Uint8Array(32).fill(9);

function ec2<const Algorithm extends -25 | -7>(
  secret: Uint8Array,
  algorithm: Algorithm,
): PreviewSignEc2PublicKey {
  const point = p256.getPublicKey(secret, false);
  return {
    kty: 2,
    algorithm,
    curve: 1,
    x: Buffer.from(point.slice(1, 33)).toString('base64url'),
    y: Buffer.from(point.slice(33)).toString('base64url'),
  };
}

function publicMaterial(): PreviewSignPublicMaterialV1 {
  const blindingKey = {
    kty: 2 as const,
    algorithm: -7,
    curve: 1 as const,
    x: 'bTvfMdDbSJiPFtRwSP3SQSPNKG5C0FEtqp9ya07PGN8',
    y: 'Ze1CFpxpZ1-Tb_feX5vZOtvI6nMDaxbo2Qrb-r2t26c',
  };
  return {
    version: PREVIEW_SIGN_PUBLIC_MATERIAL_VERSION,
    outerCredentialId: Buffer.from('outer-credential').toString('base64url'),
    outerPublicKey: blindingKey,
    previewKeyHandle: Buffer.from('preview-key-handle').toString('base64url'),
    seedPublicKey: {
      kty: -65537,
      algorithm: -65700,
      derivedAlgorithm: -9,
      blindingKey,
      kemKey: {
        kty: 2,
        algorithm: -25,
        curve: 1,
        x: 'w4u91yhhlnM_oXfkO3PP09bXLNEcwLsskjbPhaQtz_U',
        y: '36M5weB9_N_ajXvipaPHOCmR84ff4zKx3Y2m4GIs-zU',
      },
    },
  };
}

function claimInput() {
  return {
    operation: 'signing-request' as const,
    verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
    requestId: REQUEST_ID,
    credentialId: CREDENTIAL_ID,
    teamId: TEAM_ID,
    claimantId: HUMAN_ID,
    purpose: 'Approve production deployment',
    nonce: NONCE,
    expiresAt: EXPIRES_AT,
    signingPayload: Buffer.from('canonical signing input').toString('base64'),
    credentialPublicMaterial: publicMaterial(),
  };
}

function testKeyMaterial(): PreviewSignPublicMaterialV1 {
  return {
    version: PREVIEW_SIGN_PUBLIC_MATERIAL_VERSION,
    outerCredentialId: Buffer.from('outer-credential').toString('base64url'),
    outerPublicKey: ec2(OUTER_SECRET, -7),
    previewKeyHandle: Buffer.from('preview-key-handle').toString('base64url'),
    seedPublicKey: {
      kty: -65537,
      algorithm: -65700,
      derivedAlgorithm: -9,
      blindingKey: ec2(BLINDING_SECRET, -7),
      kemKey: ec2(KEM_SECRET, -25),
    },
  };
}

function reorderedPublicMaterial(
  material: PreviewSignPublicMaterialV1,
): PreviewSignPublicMaterialV1 {
  const reorder = (key: PreviewSignEc2PublicKey): PreviewSignEc2PublicKey => ({
    algorithm: key.algorithm,
    curve: key.curve,
    kty: key.kty,
    y: key.y,
    x: key.x,
  });
  return {
    previewKeyHandle: material.previewKeyHandle,
    seedPublicKey: {
      kemKey: reorder(material.seedPublicKey.kemKey),
      derivedAlgorithm: material.seedPublicKey.derivedAlgorithm,
      blindingKey: reorder(material.seedPublicKey.blindingKey),
      algorithm: material.seedPublicKey.algorithm,
      kty: material.seedPublicKey.kty,
    },
    outerPublicKey: reorder(material.outerPublicKey),
    outerCredentialId: material.outerCredentialId,
    version: material.version,
  };
}

function challengeString(
  challenge: Record<string, SigningMethodJson>,
  field: string,
): string {
  const value = challenge[field];
  if (typeof value !== 'string') {
    throw new Error(`challenge.${field} must be a string`);
  }
  return value;
}

function captureCredentialError(run: () => void): SigningCredentialError {
  try {
    run();
  } catch (error) {
    if (error instanceof SigningCredentialError) return error;
    throw error;
  }
  throw new Error('expected credential validation to fail');
}

describe('previewSign production signing method driver', () => {
  it('matches the published server vector with the production prehashed verifier', async () => {
    const driver = createPreviewSignSigningMethodDriver({
      randomBytes: () =>
        Buffer.from(serverVector.serverTestOnly.ikm, 'base64url'),
      now: () => new Date('2030-08-01T12:00:00.000Z'),
    });
    const vectorInput = {
      ...serverVector.request,
      operation: 'signing-request' as const,
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      credentialPublicMaterial: serverVector.credential
        .publicMaterial as PreviewSignPublicMaterialV1,
    };

    const prepared = await driver.prepareClaim(vectorInput);
    expect(prepared.challenge).toEqual(serverVector.challenge);
    expect(prepared.verifierState).toMatchObject(serverVector.verifierState);
    expect(
      verifyP256PrehashedSignature(
        Buffer.from(serverVector.challenge.digest, 'base64url'),
        Buffer.from(serverVector.receipt.signature, 'base64url'),
        serverVector.verifierState.derivedPublicKey as PreviewSignEc2PublicKey,
      ),
    ).toBe(true);
    const evidence = await driver.verifyReceipt({
      ...vectorInput,
      verifierState: prepared.verifierState,
      receipt: {
        ...serverVector.receipt,
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      },
    });

    expect(prepared.challenge).not.toHaveProperty('ikm');
    expect(prepared.verifierState).not.toHaveProperty('ikm');
    expect(
      Buffer.from(
        challengeString(prepared.challenge, 'envelope'),
        'base64url',
      ).toString('utf8'),
    ).toBe(serverVector.canonicalEnvelope);
    expect(evidence).toMatchObject({
      proofHash: serverVector.verification.proofHash,
      details: {
        digest: serverVector.challenge.digest,
        signature: serverVector.receipt.signature,
      },
    });
  });

  it('accepts only the stable previewSign credential vocabulary and public material', () => {
    const driver = createPreviewSignSigningMethodDriver();

    expect(() =>
      driver.validatePublicMaterial({
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        credentialType: PREVIEW_SIGN_CREDENTIAL_TYPE,
        algorithm: PREVIEW_SIGN_ALGORITHM,
        publicMaterial: publicMaterial(),
      }),
    ).not.toThrow();

    for (const invalid of [
      {
        credentialType: 'test-only',
        algorithm: PREVIEW_SIGN_ALGORITHM,
        publicMaterial: publicMaterial(),
      },
      {
        credentialType: PREVIEW_SIGN_CREDENTIAL_TYPE,
        algorithm: 'test-only',
        publicMaterial: publicMaterial(),
      },
      {
        credentialType: PREVIEW_SIGN_CREDENTIAL_TYPE,
        algorithm: PREVIEW_SIGN_ALGORITHM,
        publicMaterial: { ...publicMaterial(), privateKey: 'forbidden' },
      },
      {
        credentialType: PREVIEW_SIGN_CREDENTIAL_TYPE,
        algorithm: PREVIEW_SIGN_ALGORITHM,
        publicMaterial: {
          ...publicMaterial(),
          seedPublicKey: {
            ...publicMaterial().seedPublicKey,
            derivedAlgorithm: -7,
          },
        },
      },
    ]) {
      const error = captureCredentialError(() =>
        driver.validatePublicMaterial({
          verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
          ...invalid,
        }),
      );
      expect(error.code).toMatch(
        /^credential_(?:public_material_invalid|private_material_rejected)$/,
      );
    }
  });

  it('canonicalizes equivalent public material across serializer field order', async () => {
    const driver = createPreviewSignSigningMethodDriver({
      randomBytes: () => IKM,
    });
    const input = claimInput();

    const canonical = await driver.prepareClaim(input);
    const reordered = await driver.prepareClaim({
      ...input,
      credentialPublicMaterial: reorderedPublicMaterial(publicMaterial()),
    });

    expect(reordered).toEqual(canonical);
  });

  it('rejects real signatures made with the outer or seed key instead of the derived claim key', async () => {
    const driver = createPreviewSignSigningMethodDriver({
      randomBytes: () => IKM,
      now: () => new Date('2026-08-01T12:00:00.000Z'),
    });
    const input = {
      ...claimInput(),
      credentialPublicMaterial: testKeyMaterial(),
    };
    const prepared = await driver.prepareClaim(input);
    const digest = Buffer.from(
      challengeString(prepared.challenge, 'digest'),
      'base64url',
    );

    for (const secret of [OUTER_SECRET, BLINDING_SECRET]) {
      const signature = p256.sign(digest, secret, {
        format: 'der',
        prehash: false,
        lowS: true,
      });
      await expect(
        driver.verifyReceipt({
          ...input,
          verifierState: prepared.verifierState,
          receipt: {
            verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
            version: PREVIEW_SIGN_RECEIPT_VERSION,
            signature: Buffer.from(signature).toString('base64url'),
          },
        }),
      ).rejects.toMatchObject({
        code: 'receipt_invalid',
        reason: 'signature_invalid',
      });
    }
  });

  it('rejects the vector receipt when persisted verifier state contains a different derived key', async () => {
    const driver = createPreviewSignSigningMethodDriver({
      randomBytes: () =>
        Buffer.from(serverVector.serverTestOnly.ikm, 'base64url'),
      now: () => new Date('2030-08-01T12:00:00.000Z'),
    });
    const vectorInput = {
      ...serverVector.request,
      operation: 'signing-request' as const,
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      credentialPublicMaterial: serverVector.credential
        .publicMaterial as PreviewSignPublicMaterialV1,
    };
    const prepared = await driver.prepareClaim(vectorInput);
    const wrongDerivedKey = {
      ...publicMaterial().outerPublicKey,
      algorithm: -9,
    } as unknown as SigningMethodJson;
    const verifierState = {
      ...(prepared.verifierState as Record<string, SigningMethodJson>),
      derivedPublicKey: wrongDerivedKey,
    };

    await expect(
      driver.verifyReceipt({
        ...vectorInput,
        verifierState,
        receipt: {
          ...serverVector.receipt,
          verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        },
      }),
    ).rejects.toMatchObject({ code: 'receipt_invalid' });
  });

  it('derives a fresh server-owned key and returns no IKM', async () => {
    const verifyPrehashedSignature = vi.fn().mockReturnValue(true);
    const driver = createPreviewSignSigningMethodDriver({
      randomBytes: vi.fn(() => IKM),
      verifyPrehashedSignature,
    });

    const prepared = await driver.prepareClaim(claimInput());

    expect(prepared.challenge).toMatchObject({
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      version: 1,
      outerCredentialId: publicMaterial().outerCredentialId,
      previewKeyHandle: publicMaterial().previewKeyHandle,
    });
    expect(prepared.challenge).not.toHaveProperty('ikm');
    expect(prepared.verifierState).not.toHaveProperty('ikm');
    expect(
      Buffer.from(challengeString(prepared.challenge, 'digest'), 'base64url'),
    ).toHaveLength(32);
    expect(
      Buffer.from(
        challengeString(prepared.challenge, 'additionalArguments'),
        'base64url',
      ),
    ).not.toHaveLength(0);
    expect(prepared.verifierState).toMatchObject({
      version: 1,
      requestId: REQUEST_ID,
      credentialId: CREDENTIAL_ID,
      teamId: TEAM_ID,
      claimantId: HUMAN_ID,
      nonce: NONCE,
      purpose: 'Approve production deployment',
      expiresAt: EXPIRES_AT,
    });
  });

  it('verifies the persisted digest exactly once and returns normalized evidence', async () => {
    const verifyPrehashedSignature = vi.fn().mockReturnValue(true);
    const driver = createPreviewSignSigningMethodDriver({
      randomBytes: () => IKM,
      verifyPrehashedSignature,
    });
    const input = claimInput();
    const prepared = await driver.prepareClaim(input);
    const signature =
      'MEUCIQCEfiAIvamLdwfaDHCI2epg4Si6E3bAHlRDC6bl2fyNXAIgaRLbpQLIurx8zaf63gYqpcGF8CsP8kTMFNu9q2B2ORY';

    const evidence = await driver.verifyReceipt({
      ...input,
      verifierState: prepared.verifierState,
      receipt: {
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
        version: PREVIEW_SIGN_RECEIPT_VERSION,
        signature,
      },
    });

    expect(verifyPrehashedSignature).toHaveBeenCalledTimes(1);
    expect(verifyPrehashedSignature).toHaveBeenCalledWith(
      Buffer.from(challengeString(prepared.challenge, 'digest'), 'base64url'),
      Buffer.from(signature, 'base64url'),
      expect.objectContaining({ algorithm: -9 }),
    );
    expect(evidence).toMatchObject({
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      credentialId: CREDENTIAL_ID,
      details: {
        version: 1,
        requestId: REQUEST_ID,
        credentialId: CREDENTIAL_ID,
        digest: prepared.challenge['digest'],
        signature,
      },
    });
  });

  it.each([
    ['request', { requestId: 'wrong-request' }],
    ['credential', { credentialId: 'wrong-credential' }],
    ['team', { teamId: 'wrong-team' }],
    ['claimant', { claimantId: 'wrong-claimant' }],
    ['nonce', { nonce: 'wrong-nonce' }],
    ['purpose', { purpose: 'wrong-purpose' }],
    ['expiry', { expiresAt: '2026-08-01T12:06:00.000Z' }],
  ])(
    'rejects a %s binding mismatch before signature verification',
    async (_name, override) => {
      const verifyPrehashedSignature = vi.fn().mockReturnValue(true);
      const driver = createPreviewSignSigningMethodDriver({
        randomBytes: () => IKM,
        verifyPrehashedSignature,
      });
      const input = claimInput();
      const prepared = await driver.prepareClaim(input);

      await expect(
        driver.verifyReceipt({
          ...input,
          ...override,
          verifierState: prepared.verifierState,
          receipt: {
            verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
            version: PREVIEW_SIGN_RECEIPT_VERSION,
            signature:
              'MEUCIQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          },
        }),
      ).rejects.toMatchObject({ code: 'receipt_invalid' });
      expect(verifyPrehashedSignature).not.toHaveBeenCalled();
    },
  );

  it('reports expiry separately from a binding mismatch', async () => {
    const verifyPrehashedSignature = vi.fn().mockReturnValue(true);
    const driver = createPreviewSignSigningMethodDriver({
      randomBytes: () => IKM,
      now: () => new Date('2026-08-01T12:06:00.000Z'),
      verifyPrehashedSignature,
    });
    const input = claimInput();
    const prepared = await driver.prepareClaim(input);

    await expect(
      driver.verifyReceipt({
        ...input,
        verifierState: prepared.verifierState,
        receipt: {
          verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
          version: PREVIEW_SIGN_RECEIPT_VERSION,
          signature:
            'MEUCIQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        },
      }),
    ).rejects.toMatchObject({
      code: 'receipt_invalid',
      reason: 'expired',
    });
    expect(verifyPrehashedSignature).not.toHaveBeenCalled();
  });

  it.each([
    ['non-ISO expiry', { expiresAt: 'not-a-date' }],
    [
      'off-curve derived key',
      {
        derivedPublicKey: {
          kty: 2,
          algorithm: -9,
          curve: 1,
          x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          y: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        },
      },
    ],
  ])('rejects malformed persisted %s state', async (_name, override) => {
    const verifyPrehashedSignature = vi.fn().mockReturnValue(true);
    const driver = createPreviewSignSigningMethodDriver({
      randomBytes: () => IKM,
      verifyPrehashedSignature,
    });
    const input = claimInput();
    const prepared = await driver.prepareClaim(input);

    await expect(
      driver.verifyReceipt({
        ...input,
        verifierState: {
          ...(prepared.verifierState as Record<string, SigningMethodJson>),
          ...override,
        },
        receipt: {
          verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
          version: PREVIEW_SIGN_RECEIPT_VERSION,
          signature:
            'MEUCIQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        },
      }),
    ).rejects.toMatchObject({ code: 'receipt_invalid' });
    expect(verifyPrehashedSignature).not.toHaveBeenCalled();
  });

  it('preserves the verifier error as the receipt failure cause', async () => {
    const cause = new Error('malformed P-256 point');
    const driver = createPreviewSignSigningMethodDriver({
      randomBytes: () => IKM,
      now: () => new Date('2026-08-01T12:00:00.000Z'),
      verifyPrehashedSignature: vi.fn(() => {
        throw cause;
      }),
    });
    const input = claimInput();
    const prepared = await driver.prepareClaim(input);

    await expect(
      driver.verifyReceipt({
        ...input,
        verifierState: prepared.verifierState,
        receipt: {
          verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
          version: PREVIEW_SIGN_RECEIPT_VERSION,
          signature:
            'MEUCIQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        },
      }),
    ).rejects.toMatchObject({
      code: 'receipt_invalid',
      reason: 'signature_verification_failed',
      cause,
    });
  });

  it('rejects DER signatures longer than the P-256 maximum', () => {
    const driver = createPreviewSignSigningMethodDriver();
    const oversizedSignature = Buffer.concat([
      Buffer.from([0x30]),
      Buffer.alloc(72),
    ]).toString('base64url');

    expect(
      driver.isReceiptReplay?.(
        {
          verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
          version: PREVIEW_SIGN_RECEIPT_VERSION,
          signature: oversizedSignature,
        },
        {
          version: 1,
          signature: oversizedSignature,
        },
      ),
    ).toBe(false);
  });

  it('matches only an identical receipt with intact evidence bindings', async () => {
    const driver = createPreviewSignSigningMethodDriver({
      randomBytes: () => IKM,
      verifyPrehashedSignature: vi.fn().mockReturnValue(true),
    });
    const input = claimInput();
    const prepared = await driver.prepareClaim(input);
    const receipt = {
      verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      version: PREVIEW_SIGN_RECEIPT_VERSION,
      signature:
        'MEUCIQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    };
    const verified = await driver.verifyReceipt({
      ...input,
      verifierState: prepared.verifierState,
      receipt,
    });
    if (
      verified.details === undefined ||
      verified.details === null ||
      Array.isArray(verified.details) ||
      typeof verified.details !== 'object'
    ) {
      throw new Error('expected object evidence');
    }
    const evidence = verified.details;

    expect(driver.isReceiptReplay?.(receipt, evidence)).toBe(true);
    expect(driver.isReceiptReplay?.({ ...receipt, version: 2 }, evidence)).toBe(
      false,
    );
    expect(
      driver.isReceiptReplay?.(
        {
          ...receipt,
          signature:
            'MEUCIQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ',
        },
        evidence,
      ),
    ).toBe(false);
    expect(
      driver.isReceiptReplay?.(receipt, {
        ...evidence,
        requestId: 'tampered-request',
      }),
    ).toBe(false);
  });

  it('rejects an invalid signature against the persisted derived key', async () => {
    const driver = createPreviewSignSigningMethodDriver({
      randomBytes: () => IKM,
      verifyPrehashedSignature: vi.fn().mockReturnValue(false),
    });
    const input = claimInput();
    const prepared = await driver.prepareClaim(input);

    await expect(
      driver.verifyReceipt({
        ...input,
        verifierState: prepared.verifierState,
        receipt: {
          verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
          version: PREVIEW_SIGN_RECEIPT_VERSION,
          signature:
            'MEUCIQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        },
      }),
    ).rejects.toMatchObject({
      code: 'receipt_invalid',
      reason: 'signature_invalid',
    });
  });
});
