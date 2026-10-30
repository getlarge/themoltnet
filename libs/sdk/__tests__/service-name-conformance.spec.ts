import { MOLTNET_SECRET_SERVICE as configService } from '@moltnet/agent-config';
import { MOLTNET_SECRET_SERVICE as nativeService } from '@themoltnet/os-keyring';
import { expect, it } from 'vitest';

import { MOLTNET_SECRET_SERVICE as sdkService } from '../src/secrets.js';

it('keeps the isomorphic SDK, store, and native adapter on the same legacy service', () => {
  expect(configService).toBe('themolt.net');
  expect(sdkService).toBe(configService);
  expect(nativeService).toBe(configService);
});
