/**
 * @moltnet/embedding-service — Embedding Service
 *
 * Generates 384-dimensional text embeddings using intfloat/e5-small-v2
 * via @huggingface/transformers (ONNX runtime).
 */

import type {
  EmbeddingLogger,
  EmbeddingService,
  EmbeddingServiceOptions,
} from './types.js';

const DEFAULT_MODEL_ID = 'intfloat/e5-small-v2';
const DEFAULT_DIMENSIONS = 384;
const DEFAULT_QUANTIZATION = 'q8';

const noopLogger: EmbeddingLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

type FeatureExtractionPipeline = (
  texts: string[],
  options?: { pooling: string; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

function getOrCreatePipeline(
  modelId: string,
  quantization: string,
  cacheDir: string | undefined,
  logger: EmbeddingLogger,
): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    logger.info(
      { modelId, quantization },
      'Loading embedding model (first call)',
    );
    pipelinePromise = loadPipeline(
      modelId,
      quantization,
      cacheDir,
      logger,
    ).catch((err) => {
      pipelinePromise = null;
      throw err;
    });
  }
  return pipelinePromise;
}

async function loadPipeline(
  modelId: string,
  quantization: string,
  cacheDir: string | undefined,
  logger: EmbeddingLogger,
): Promise<FeatureExtractionPipeline> {
  const { pipeline, env } = await import('@huggingface/transformers');

  // Disable remote model fetching attempts via browser APIs
  env.allowLocalModels = true;
  if (cacheDir) {
    env.cacheDir = cacheDir;
  }

  const extractor = await pipeline('feature-extraction', modelId, {
    dtype: quantization as 'q8' | 'q4' | 'fp32' | 'fp16',
  });

  logger.info({ modelId }, 'Embedding model loaded');
  return extractor as unknown as FeatureExtractionPipeline;
}

function l2Normalize(vector: number[]): number[] {
  let norm = 0;
  for (const v of vector) {
    norm += v * v;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) {
    return vector;
  }
  return vector.map((v) => v / norm);
}

export function createEmbeddingService(
  options?: EmbeddingServiceOptions,
): EmbeddingService {
  const modelId = options?.modelId ?? DEFAULT_MODEL_ID;
  const dimensions = options?.dimensions ?? DEFAULT_DIMENSIONS;
  const quantization = options?.quantization ?? DEFAULT_QUANTIZATION;
  const cacheDir = options?.cacheDir;
  const logger = options?.logger ?? noopLogger;

  async function embed(text: string): Promise<number[]> {
    const extractor = await getOrCreatePipeline(
      modelId,
      quantization,
      cacheDir,
      logger,
    );
    const output = await extractor([text], {
      pooling: 'mean',
      normalize: false,
    });
    const vectors = output.tolist();
    const raw = vectors[0];

    if (raw.length !== dimensions) {
      logger.warn(
        { expected: dimensions, actual: raw.length },
        'Embedding dimension mismatch',
      );
    }

    return l2Normalize(raw);
  }

  return {
    async embedPassage(text: string): Promise<number[]> {
      return embed(`passage: ${text}`);
    },
    async embedQuery(text: string): Promise<number[]> {
      return embed(`query: ${text}`);
    },
  };
}

/**
 * Reset the cached pipeline — used for testing only.
 */
export function resetPipeline(): void {
  pipelinePromise = null;
}
