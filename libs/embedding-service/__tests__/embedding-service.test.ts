import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmbeddingLogger } from '../src/types.js';

// Mock @huggingface/transformers before any imports that use it
const mockExtractor = vi.fn();
const mockEnv = {
  allowLocalModels: false,
  cacheDir: '',
};

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn().mockResolvedValue(mockExtractor),
  env: mockEnv,
}));

// Import after mock setup
import {
  createEmbeddingService,
  resetPipeline,
} from '../src/embedding-service.js';

function createMockLogger(): {
  [K in keyof EmbeddingLogger]: ReturnType<typeof vi.fn>;
} {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeRawVector(length: number, fill = 0.5): number[] {
  return Array.from({ length }, () => fill);
}

describe('createEmbeddingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPipeline();
    mockEnv.allowLocalModels = false;
    mockEnv.cacheDir = '';
  });

  it('returns an object with embedPassage and embedQuery methods', () => {
    const service = createEmbeddingService();

    expect(typeof service.embedPassage).toBe('function');
    expect(typeof service.embedQuery).toBe('function');
  });

  describe('embedPassage', () => {
    it('prepends "passage: " to the input text', async () => {
      // Arrange
      const raw = makeRawVector(384);
      mockExtractor.mockResolvedValue({ tolist: () => [raw] });
      const service = createEmbeddingService();

      // Act
      await service.embedPassage('hello world');

      // Assert
      expect(mockExtractor).toHaveBeenCalledWith(['passage: hello world'], {
        pooling: 'mean',
        normalize: false,
      });
    });

    it('returns an L2-normalized vector', async () => {
      // Arrange
      const raw = makeRawVector(384, 1.0);
      mockExtractor.mockResolvedValue({ tolist: () => [raw] });
      const service = createEmbeddingService();

      // Act
      const result = await service.embedPassage('test');

      // Assert
      expect(result).toHaveLength(384);
      const norm = Math.sqrt(result.reduce((sum, v) => sum + v * v, 0));
      expect(norm).toBeCloseTo(1.0, 5);
    });
  });

  describe('embedQuery', () => {
    it('prepends "query: " to the input text', async () => {
      // Arrange
      const raw = makeRawVector(384);
      mockExtractor.mockResolvedValue({ tolist: () => [raw] });
      const service = createEmbeddingService();

      // Act
      await service.embedQuery('search term');

      // Assert
      expect(mockExtractor).toHaveBeenCalledWith(['query: search term'], {
        pooling: 'mean',
        normalize: false,
      });
    });

    it('returns an L2-normalized vector', async () => {
      // Arrange
      const raw = makeRawVector(384, 2.0);
      mockExtractor.mockResolvedValue({ tolist: () => [raw] });
      const service = createEmbeddingService();

      // Act
      const result = await service.embedQuery('test');

      // Assert
      expect(result).toHaveLength(384);
      const norm = Math.sqrt(result.reduce((sum, v) => sum + v * v, 0));
      expect(norm).toBeCloseTo(1.0, 5);
    });
  });

  describe('L2 normalization', () => {
    it('produces unit-length vectors from varying input magnitudes', async () => {
      // Arrange
      const raw = Array.from({ length: 384 }, (_, i) => (i + 1) * 0.1);
      mockExtractor.mockResolvedValue({ tolist: () => [raw] });
      const service = createEmbeddingService();

      // Act
      const result = await service.embedPassage('text');

      // Assert
      const norm = Math.sqrt(result.reduce((sum, v) => sum + v * v, 0));
      expect(norm).toBeCloseTo(1.0, 5);
    });

    it('handles zero vector without NaN', async () => {
      // Arrange
      const raw = makeRawVector(384, 0);
      mockExtractor.mockResolvedValue({ tolist: () => [raw] });
      const service = createEmbeddingService();

      // Act
      const result = await service.embedPassage('empty');

      // Assert
      expect(result).toHaveLength(384);
      expect(result.every((v) => v === 0)).toBe(true);
      expect(result.some((v) => Number.isNaN(v))).toBe(false);
    });
  });

  describe('lazy loading', () => {
    it('loads the model on first call only and reuses it', async () => {
      // Arrange
      const { pipeline } = await import('@huggingface/transformers');
      const raw = makeRawVector(384);
      mockExtractor.mockResolvedValue({ tolist: () => [raw] });
      const service = createEmbeddingService();

      // Act
      await service.embedPassage('first');
      await service.embedQuery('second');
      await service.embedPassage('third');

      // Assert
      expect(pipeline).toHaveBeenCalledTimes(1);
      expect(mockExtractor).toHaveBeenCalledTimes(3);
    });
  });

  describe('pipeline loading failure recovery', () => {
    it('retries loading after a transient failure', async () => {
      // Arrange
      const transformers = await import('@huggingface/transformers');
      const pipelineSpy = vi.spyOn(transformers, 'pipeline');

      (pipelineSpy as any).mockRejectedValueOnce(new Error('network timeout'));

      const raw = makeRawVector(384);
      mockExtractor.mockResolvedValue({ tolist: () => [raw] });

      (pipelineSpy as any).mockResolvedValueOnce(mockExtractor);

      const service = createEmbeddingService();

      // Act — first call fails
      await expect(service.embedPassage('first')).rejects.toThrow(
        'network timeout',
      );

      // Act — second call retries and succeeds
      const result = await service.embedPassage('second');

      // Assert
      expect(pipelineSpy).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(384);
    });
  });

  describe('dimension mismatch', () => {
    it('logs a warning but still returns the result', async () => {
      // Arrange
      const raw = makeRawVector(256, 1.0);
      mockExtractor.mockResolvedValue({ tolist: () => [raw] });
      const logger = createMockLogger();
      const service = createEmbeddingService({ logger });

      // Act
      const result = await service.embedPassage('text');

      // Assert
      expect(result).toHaveLength(256);
      expect(logger.warn).toHaveBeenCalledWith(
        { expected: 384, actual: 256 },
        'Embedding dimension mismatch',
      );
    });
  });

  describe('options', () => {
    it('passes modelId and quantization to pipeline', async () => {
      // Arrange
      const { pipeline } = await import('@huggingface/transformers');
      const raw = makeRawVector(384);
      mockExtractor.mockResolvedValue({ tolist: () => [raw] });

      const service = createEmbeddingService({
        modelId: 'custom/model',
        quantization: 'fp32',
      });

      // Act
      await service.embedPassage('text');

      // Assert
      expect(pipeline).toHaveBeenCalledWith(
        'feature-extraction',
        'custom/model',
        { dtype: 'fp32' },
      );
    });

    it('sets cacheDir on env when provided', async () => {
      // Arrange
      const raw = makeRawVector(384);
      mockExtractor.mockResolvedValue({ tolist: () => [raw] });
      const service = createEmbeddingService({
        cacheDir: '/tmp/models',
      });

      // Act
      await service.embedPassage('text');

      // Assert
      expect(mockEnv.cacheDir).toBe('/tmp/models');
    });
  });
});
