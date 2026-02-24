/**
 * @moltnet/embedding-service — Embedding Service
 *
 * Generates 384-dimensional text embeddings using Xenova/e5-small-v2
 * via @huggingface/transformers (ONNX runtime).
 */

import { env, pipeline } from '@huggingface/transformers';

import type {
  EmbeddingLogger,
  EmbeddingService,
  EmbeddingServiceOptions,
} from './types.js';

const DEFAULT_MODEL_ID = 'Xenova/e5-small-v2';
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

async function loadPipeline(
  modelId: string,
  quantization: string,
  cacheDir: string | undefined,
  allowRemoteModels: boolean,
  logger: EmbeddingLogger,
): Promise<FeatureExtractionPipeline> {
  // env is global module state — save and restore to avoid cross-instance
  // interference if multiple services initialize concurrently.
  const prevAllowLocal = env.allowLocalModels;
  const prevAllowRemote = env.allowRemoteModels;
  env.allowLocalModels = true;
  env.allowRemoteModels = allowRemoteModels;

  try {
    const extractor = await pipeline('feature-extraction', modelId, {
      dtype: quantization as 'q8' | 'q4' | 'fp32' | 'fp16',
      ...(cacheDir ? { cache_dir: cacheDir } : {}),
      ...(!allowRemoteModels ? { local_files_only: true } : {}),
    });

    logger.info({ modelId }, 'Embedding model loaded');
    return extractor as unknown as FeatureExtractionPipeline;
  } finally {
    env.allowLocalModels = prevAllowLocal;
    env.allowRemoteModels = prevAllowRemote;
  }
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
  const allowRemoteModels = options?.allowRemoteModels ?? true;
  const logger = options?.logger ?? noopLogger;

  let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

  function getOrCreatePipeline(): Promise<FeatureExtractionPipeline> {
    if (!pipelinePromise) {
      logger.info(
        { modelId, quantization },
        'Loading embedding model (first call)',
      );
      pipelinePromise = loadPipeline(
        modelId,
        quantization,
        cacheDir,
        allowRemoteModels,
        logger,
      ).catch((err) => {
        pipelinePromise = null;
        throw err;
      });
    }
    return pipelinePromise;
  }

  async function embed(text: string): Promise<number[]> {
    const extractor = await getOrCreatePipeline();
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
