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
}

export interface EmbeddingService {
  embedPassage(text: string): Promise<number[]>;
  embedQuery(text: string): Promise<number[]>;
}
