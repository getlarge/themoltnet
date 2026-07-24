import { p256 } from '@noble/curves/nist.js';
import { type CtapConnection } from '@themoltnet/ctap';
import {
  asMap,
  decodeCbor,
  encodeCbor,
  mapBytes,
  mapNumber,
} from '@themoltnet/ctap/cbor';
import { describe, expect, it } from 'vitest';

import { concatBytes, sha256, toBase64Url, utf8 } from './bytes.js';
import {
  parseAuthenticatorData,
  PreviewSignCtapClient,
} from './preview-sign.js';

function ec2(point: Uint8Array, algorithm: number) {
  return new Map<unknown, unknown>([
    [1, 2],
    [3, algorithm],
    [-1, 1],
    [-2, point.slice(1, 33)],
    [-3, point.slice(33)],
  ]);
}

function authData(input: {
  credentialId?: Uint8Array;
  publicKey?: unknown;
  extensions?: Map<unknown, unknown>;
}): Uint8Array {
  const flags =
    0x01 | (input.credentialId ? 0x40 : 0) | (input.extensions ? 0x80 : 0);
  const parts = [
    sha256(utf8('preview-sign.local')),
    Uint8Array.of(flags),
    new Uint8Array(4),
  ];
  if (input.credentialId && input.publicKey) {
    parts.push(
      new Uint8Array(16),
      Uint8Array.of(0, input.credentialId.length),
      input.credentialId,
      encodeCbor(input.publicKey),
    );
  }
  if (input.extensions) parts.push(encodeCbor(input.extensions));
  return concatBytes(...parts);
}

const device = {
  id: 'device',
  path: '/device',
  vendorId: 0x1050,
  productId: 1,
};

describe('previewSign CTAP protocol', () => {
  it('decodes advertised capabilities', async () => {
    const connection: CtapConnection = {
      device,
      async cbor(command) {
        expect(command).toBe(0x04);
        return encodeCbor(
          new Map<unknown, unknown>([
            [1, ['FIDO_2_1']],
            [2, ['credProtect', 'previewSign']],
            [3, new Uint8Array(16)],
            [4, new Map([['rk', true]])],
          ]),
        );
      },
      async close() {},
    };
    const result = await new PreviewSignCtapClient(
      connection,
    ).getCapabilities();
    expect(result).toMatchObject({
      supportsPreviewSign: true,
      supportsCtap23: true,
      options: { rk: true },
    });
  });

  it('rejects older authenticators without previewSign', async () => {
    const connection: CtapConnection = {
      device,
      async cbor(command) {
        expect(command).toBe(0x04);
        return encodeCbor(
          new Map<unknown, unknown>([
            [1, ['FIDO_2_1']],
            [2, ['credProtect', 'hmac-secret']],
          ]),
        );
      },
      async close() {},
    };

    await expect(
      new PreviewSignCtapClient(connection).generateKey(),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_DEVICE',
    });
  });

  it('encodes enrollment and decodes nested previewSign output', async () => {
    const outerPublic = p256.getPublicKey(new Uint8Array(32).fill(1), false);
    const seed = new Map<unknown, unknown>([
      [1, -65537],
      [3, -65700],
      [-1, ec2(p256.getPublicKey(new Uint8Array(32).fill(2), false), -7)],
      [-2, ec2(p256.getPublicKey(new Uint8Array(32).fill(3), false), -25)],
      [-3, -9],
    ]);
    const inner = encodeCbor(
      new Map<unknown, unknown>([
        [1, 'packed'],
        [
          2,
          authData({
            credentialId: Uint8Array.of(4, 5, 6),
            publicKey: seed,
          }),
        ],
      ]),
    );
    let captured: Uint8Array | undefined;
    const connection: CtapConnection = {
      device,
      async cbor(command, request) {
        if (command === 0x04) {
          return encodeCbor(
            new Map<unknown, unknown>([
              [1, ['FIDO_2_1']],
              [2, ['previewSign']],
            ]),
          );
        }
        captured = request;
        return encodeCbor(
          new Map<unknown, unknown>([
            [
              2,
              authData({
                credentialId: Uint8Array.of(1, 2, 3),
                publicKey: ec2(outerPublic, -7),
                extensions: new Map([['previewSign', new Map([[3, -65539]])]]),
              }),
            ],
            [6, new Map([['previewSign', new Map([[7, inner]])]])],
          ]),
        );
      },
      async close() {},
    };
    const result = await new PreviewSignCtapClient(connection).generateKey();
    expect(result.previewKeyHandle).toEqual(Uint8Array.of(4, 5, 6));
    expect(result.seedPublicKey.algorithm).toBe(-65700);
    const extension = asMap(asMap(decodeCbor(captured!)).get(6));
    const preview = asMap(extension.get('previewSign'));
    expect(preview.get(3)).toEqual([-65539]);
    expect(mapNumber(preview, 4, 'presence')).toBe(1);
  });

  it('passes the digest as-is and verifies the outer assertion', async () => {
    const outerSecret = new Uint8Array(32).fill(7);
    const outerPublic = p256.getPublicKey(outerSecret, false);
    const digest = sha256(utf8('action'));
    const previewSignature = p256.sign(digest, new Uint8Array(32).fill(9), {
      format: 'der',
      prehash: false,
    });
    let captured: Uint8Array | undefined;
    const connection: CtapConnection = {
      device,
      async cbor(command, request) {
        expect(command).toBe(0x02);
        captured = request;
        const decoded = asMap(decodeCbor(request!));
        const clientDataHash = mapBytes(decoded, 2, 'client data');
        const data = authData({
          extensions: new Map([
            ['previewSign', new Map([[6, previewSignature]])],
          ]),
        });
        const outerSignature = p256.sign(
          concatBytes(data, clientDataHash),
          outerSecret,
          { format: 'der' },
        );
        return encodeCbor(
          new Map<unknown, unknown>([
            [2, data],
            [3, outerSignature],
          ]),
        );
      },
      async close() {},
    };
    const result = await new PreviewSignCtapClient(connection).signByCredential(
      {
        outerCredentialId: Uint8Array.of(1),
        outerPublicKey: {
          kty: 2,
          algorithm: -7,
          curve: 1,
          x: toBase64Url(outerPublic.slice(1, 33)),
          y: toBase64Url(outerPublic.slice(33)),
        },
        previewKeyHandle: Uint8Array.of(2),
        toBeSigned: digest,
        additionalArguments: Uint8Array.of(3),
      },
    );
    expect(result).toEqual(previewSignature);
    const preview = asMap(
      asMap(asMap(decodeCbor(captured!)).get(4)).get('previewSign'),
    );
    expect(mapBytes(preview, 6, 'tbs')).toEqual(digest);
  });

  it('rejects an assertion signed by a substituted outer key', async () => {
    const enrolledSecret = new Uint8Array(32).fill(7);
    const attackerSecret = new Uint8Array(32).fill(8);
    const outerPublic = p256.getPublicKey(enrolledSecret, false);
    const digest = sha256(utf8('action'));
    const connection: CtapConnection = {
      device,
      async cbor(_command, request) {
        const decoded = asMap(decodeCbor(request!));
        const clientDataHash = mapBytes(decoded, 2, 'client data');
        const data = authData({
          extensions: new Map([
            ['previewSign', new Map([[6, Uint8Array.of(9, 8, 7)]])],
          ]),
        });
        return encodeCbor(
          new Map<unknown, unknown>([
            [2, data],
            [
              3,
              p256.sign(concatBytes(data, clientDataHash), attackerSecret, {
                format: 'der',
              }),
            ],
          ]),
        );
      },
      async close() {},
    };

    await expect(
      new PreviewSignCtapClient(connection).signByCredential({
        outerCredentialId: Uint8Array.of(1),
        outerPublicKey: {
          kty: 2,
          algorithm: -7,
          curve: 1,
          x: toBase64Url(outerPublic.slice(1, 33)),
          y: toBase64Url(outerPublic.slice(33)),
        },
        previewKeyHandle: Uint8Array.of(2),
        toBeSigned: digest,
        additionalArguments: Uint8Array.of(3),
      }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_FAILED' });
  });

  it('rejects truncated authenticator data', () => {
    expect(() => parseAuthenticatorData(new Uint8Array(36))).toThrow(
      /too short/u,
    );
  });
});
