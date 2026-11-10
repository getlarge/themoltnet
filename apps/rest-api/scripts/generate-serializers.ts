import { writeFileSync } from 'node:fs';

import { buildSchemaApp } from './schema-app.js';
import { createSerializerArtifactBuilder } from './serializer-artifact-builder.js';

const output = process.argv[2];
if (!output) throw new Error('Pass the serializer artifact output path');

const builder = createSerializerArtifactBuilder();
const app = await buildSchemaApp({
  serializerCompilerFactory: builder.factory,
});
try {
  await app.ready();
  writeFileSync(output, builder.source());
} finally {
  await app.close();
}

// Route modules may register background SDK timers; this build-only process
// has finished its synchronous artifact write and closed the Fastify app.
process.exit(0);
