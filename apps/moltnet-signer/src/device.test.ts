import {
  type PreviewSignClient,
  PreviewSignPresence,
} from '@themoltnet/yubikey-preview-sign';
import { describe, expect, it, vi } from 'vitest';

import { createPreviewSignDevice } from './device.js';

function clientFixture() {
  const client = {
    listDevices: vi.fn(() =>
      Promise.resolve([
        {
          id: 'key-1',
          path: '/dev/key-1',
          vendorId: 0x1050,
          productId: 1,
        },
      ]),
    ),
    getCapabilities: vi.fn(() =>
      Promise.resolve({
        device: {
          id: 'key-1',
          path: '/dev/key-1',
          vendorId: 0x1050,
          productId: 1,
        },
        versions: ['FIDO_2_1'],
        extensions: ['previewSign'],
        options: {},
        supportsPreviewSign: true,
        supportsCtap23: true,
      }),
    ),
    enroll: vi.fn(() =>
      Promise.resolve({
        version: 'preview-sign.enrollment.v1' as const,
        id: 'local-record',
        createdAt: '2030-08-01T12:00:00.000Z',
        label: 'Operator key',
        device: {
          id: 'key-1',
          vendorId: 0x1050,
          productId: 1,
        },
        capabilities: {
          versions: ['FIDO_2_1'],
          extensions: ['previewSign'],
          options: {},
          supportsPreviewSign: true,
          supportsCtap23: true,
        },
        outerCredentialId: 'Y3JlZGVudGlhbA',
        outerPublicKey: {
          kty: 2 as const,
          algorithm: -7,
          curve: 1 as const,
          x: 'A'.repeat(43),
          y: 'B'.repeat(43),
        },
        previewKeyHandle: 'aGFuZGxl',
        seedPublicKey: {
          kty: -65537 as const,
          algorithm: -65700 as const,
          derivedAlgorithm: -9 as const,
          blindingKey: {
            kty: 2 as const,
            algorithm: -7,
            curve: 1 as const,
            x: 'C'.repeat(43),
            y: 'D'.repeat(43),
          },
          kemKey: {
            kty: 2 as const,
            algorithm: -25,
            curve: 1 as const,
            x: 'E'.repeat(43),
            y: 'F'.repeat(43),
          },
          encoded: 'c2VlZC1wdWJsaWMta2V5',
        },
        algorithm: -65539 as const,
        attestation: {
          format: 'packed',
          object: 'cHJpdmF0ZS1hdHRlc3RhdGlvbg',
          verified: true,
          trust: 'self' as const,
        },
      }),
    ),
    signPreparedDigest: vi.fn(() =>
      Promise.resolve(Uint8Array.of(0x30, 1, 2, 3)),
    ),
  };
  return client;
}

describe('previewSign device adapter', () => {
  it('returns only versioned public enrollment material', async () => {
    const client = clientFixture();
    const device = createPreviewSignDevice(
      client as unknown as PreviewSignClient,
    );

    const result = await device.enroll('Operator key');

    expect(client.enroll).toHaveBeenCalledWith({
      deviceId: 'key-1',
      label: 'Operator key',
      presence: PreviewSignPresence.RequireUserPresence,
    });
    expect(result).not.toHaveProperty('device');
    expect(result).not.toHaveProperty('attestation');
    expect(result.seedPublicKey).not.toHaveProperty('encoded');
    expect(JSON.stringify(result)).not.toMatch(/private|ikm|attestation/iu);
  });

  it('refuses ambiguous or unsupported device selection', async () => {
    const client = clientFixture();
    client.listDevices.mockResolvedValueOnce([]);
    const device = createPreviewSignDevice(
      client as unknown as PreviewSignClient,
    );

    await expect(device.enroll('Operator key')).rejects.toThrow(
      /Connect one previewSign-capable/u,
    );
    expect(client.enroll).not.toHaveBeenCalled();
  });
});
