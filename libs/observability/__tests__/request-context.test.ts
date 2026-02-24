import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @opentelemetry/api before importing the module under test
vi.mock('@opentelemetry/api', () => ({
  trace: {
    getActiveSpan: vi.fn(),
  },
}));

import { trace } from '@opentelemetry/api';
import type { Logger } from 'pino';

import {
  getContextLogger,
  runWithRequestContext,
  setRequestContextField,
} from '../src/request-context.js';

const mockChild = vi.fn().mockReturnValue({ level: 'info' });
const mockLogger = { child: mockChild } as unknown as Logger;

describe('runWithRequestContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('makes requestId available to getContextLogger within the callback', () => {
    // Arrange
    const requestId = 'req-123';

    // Act
    runWithRequestContext({ requestId }, () => {
      getContextLogger(mockLogger);
    });

    // Assert
    expect(mockChild).toHaveBeenCalledWith(
      expect.objectContaining({ requestId }),
    );
  });

  it('does not leak context outside the callback', () => {
    // Arrange + Act
    runWithRequestContext({ requestId: 'req-leak' }, () => {});
    getContextLogger(mockLogger);

    // Assert
    expect(mockChild).toHaveBeenCalledWith(
      expect.not.objectContaining({ requestId: 'req-leak' }),
    );
  });
});

describe('setRequestContextField', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds identityId to context after initial setup', () => {
    // Arrange
    const requestId = 'req-456';
    const identityId = 'agent-abc';

    // Act
    runWithRequestContext({ requestId }, () => {
      setRequestContextField('identityId', identityId);
      getContextLogger(mockLogger);
    });

    // Assert
    expect(mockChild).toHaveBeenCalledWith(
      expect.objectContaining({ requestId, identityId }),
    );
  });

  it('is a no-op when called outside a context', () => {
    // Act + Assert (nothing to arrange, nothing to capture)
    expect(() => setRequestContextField('identityId', 'orphan')).not.toThrow();
  });
});

describe('getContextLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes traceId and spanId when OTel has an active span', () => {
    // Arrange
    vi.mocked(trace.getActiveSpan).mockReturnValue({
      spanContext: () => ({
        traceId: 'trace-111',
        spanId: 'span-222',
        traceFlags: 1,
        isRemote: false,
      }),
    } as ReturnType<typeof trace.getActiveSpan>);

    // Act
    runWithRequestContext({ requestId: 'req-otel' }, () => {
      getContextLogger(mockLogger);
    });

    // Assert
    expect(mockChild).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: 'trace-111', spanId: 'span-222' }),
    );
  });

  it('omits traceId when no active span', () => {
    // Arrange
    vi.mocked(trace.getActiveSpan).mockReturnValue(undefined);

    // Act
    runWithRequestContext({ requestId: 'req-notrace' }, () => {
      getContextLogger(mockLogger);
    });

    // Assert
    expect(mockChild).toHaveBeenCalledWith(
      expect.not.objectContaining({ traceId: expect.anything() }),
    );
  });
});
