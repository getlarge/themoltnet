/**
 * @moltnet/embedding-service — Type Definitions
 */

export interface EmbeddingLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
}

export interface EmbeddingServiceOptions {
  modelId?: string;
  dimensions?: number;
  quantization?: 'q8' | 'q4' | 'fp32' | 'fp16';
  cacheDir?: string;
  /** Allow downloading models from huggingface.co at runtime (default: true) */
  allowRemoteModels?: boolean;
  logger?: EmbeddingLogger;
  /**
   * Where inference runs (default: `worker`). Inference is CPU-bound and
   * blocks the thread that runs it for its whole duration, so servers must
   * keep the default. `inline` exists for unit tests that mock the model
   * in-process.
   */
  executor?: 'worker' | 'inline';
  /**
   * @internal Test seam: absolute path of a module that replaces
   * `@huggingface/transformers` inside the worker.
   */
  transformersModulePath?: string;
}

export interface EmbeddingService {
  embedPassage(text: string): Promise<number[]>;
  embedQuery(text: string): Promise<number[]>;
  /** Release resources (the inference worker). Later calls reject. */
  close?(): Promise<void>;
}
