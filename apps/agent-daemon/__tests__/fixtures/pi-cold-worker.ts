import { randomUUID } from 'node:crypto';

import { computeJsonCid } from '@moltnet/crypto-service';

import {
  defaultPiDaemonAdapter,
  defaultPiRuntimeDefinition,
} from '../../src/pi.js';

const prepared = await defaultPiDaemonAdapter.prepare({
  profile: {
    id: randomUUID(),
    definitionCid: await computeJsonCid({ fixture: 'cold-start' }),
    runtimeKind: defaultPiRuntimeDefinition.runtimeKind,
    models: { generation: { provider: 'fixture', model: 'unused' } },
    sandboxConfig: {},
  },
  onProgress: (message) => process.stderr.write(`${process.pid}: ${message}\n`),
});
process.stdout.write(
  JSON.stringify({ pid: process.pid, manifest: prepared.manifest }) + '\n',
);
