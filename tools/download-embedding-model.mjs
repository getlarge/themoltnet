/**
 * Download Xenova/e5-small-v2 (q8 ONNX) into a target directory.
 *
 * Usage:
 *   node tools/download-embedding-model.mjs [--cache-dir /path/to/models]
 *
 * Defaults to /app/models (production Docker target).
 * Used at Docker build time to bake the model into the image.
 */

import { env, pipeline } from '@huggingface/transformers';

const MODEL_ID = 'Xenova/e5-small-v2';
const QUANTIZATION = 'q8';

const cacheDirArg = process.argv.indexOf('--cache-dir');
let CACHE_DIR = '/app/models';

if (cacheDirArg !== -1) {
  const cacheDirValue = process.argv[cacheDirArg + 1];
  if (!cacheDirValue || cacheDirValue.startsWith('--')) {
    console.error(
      'Error: --cache-dir requires a directory path.\n' +
        'Usage: node tools/download-embedding-model.mjs [--cache-dir /path/to/models]',
    );
    process.exit(1);
  }
  CACHE_DIR = cacheDirValue;
}

env.allowLocalModels = true;
env.allowRemoteModels = true;

console.log(`Downloading ${MODEL_ID} (${QUANTIZATION}) into ${CACHE_DIR}...`);

const extractor = await pipeline('feature-extraction', MODEL_ID, {
  dtype: QUANTIZATION,
  cache_dir: CACHE_DIR,
});

// Warm up with a dummy inference to ensure all files are fully written
await extractor(['warm-up'], { pooling: 'mean', normalize: false });

console.log('Model downloaded successfully.');
