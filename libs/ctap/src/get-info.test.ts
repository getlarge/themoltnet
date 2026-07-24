import { describe, expect, it } from 'vitest';

import { encodeCbor } from './cbor.js';
import { getInfo } from './get-info.js';

describe('authenticatorGetInfo', () => {
  it('decodes standard text-keyed algorithm descriptors', async () => {
    const result = await getInfo({
      device: {
        id: 'device',
        path: '/device',
        vendorId: 0x1050,
        productId: 1,
      },
      async cbor(command) {
        expect(command).toBe(0x04);
        return encodeCbor(
          new Map<unknown, unknown>([
            [1, ['FIDO_2_1']],
            [2, ['previewSign']],
            [
              10,
              [
                new Map<unknown, unknown>([
                  ['alg', -7],
                  ['type', 'public-key'],
                ]),
              ],
            ],
          ]),
        );
      },
      async close() {},
    });

    expect(result).toMatchObject({
      versions: ['FIDO_2_1'],
      extensions: ['previewSign'],
      algorithms: [-7],
    });
  });
});
