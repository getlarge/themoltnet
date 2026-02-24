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
    runWithRequestContext({ requestId: 'req-123' }, () => {
      getContextLogger(mockLogger);
      expect(mockChild).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req-123' }),
      );
    });
  });

  it('does not leak context outside the callback', () => {
    runWithRequestContext({ requestId: 'req-leak' }, () => {});
    getContextLogger(mockLogger);
    expect(mockChild).toHaveBeenCalledWith(
      expect.not.objectContaining({ requestId: 'req-leak' }),
    );
  });
});

describe('setRequestContextField', () => {
  it('adds identityId to context after initial setup', () => {
    runWithRequestContext({ requestId: 'req-456' }, () => {
      setRequestContextField('identityId', 'agent-abc');
      getContextLogger(mockLogger);
      expect(mockChild).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'req-456',
          identityId: 'agent-abc',
        }),
      );
    });
  });

  it('is a no-op when called outside a context', () => {
    // Should not throw
    expect(() => setRequestContextField('identityId', 'orphan')).not.toThrow();
  });
});

describe('getContextLogger', () => {
  it('includes traceId and spanId when OTel has an active span', () => {
    vi.mocked(trace.getActiveSpan).mockReturnValue({
      spanContext: () => ({
        traceId: 'trace-111',
        spanId: 'span-222',
        traceFlags: 1,
        isRemote: false,
      }),
    } as ReturnType<typeof trace.getActiveSpan>);

    runWithRequestContext({ requestId: 'req-otel' }, () => {
      getContextLogger(mockLogger);
      expect(mockChild).toHaveBeenCalledWith(
        expect.objectContaining({ traceId: 'trace-111', spanId: 'span-222' }),
      );
    });
  });

  it('omits traceId when no active span', () => {
    vi.mocked(trace.getActiveSpan).mockReturnValue(undefined);

    runWithRequestContext({ requestId: 'req-notrace' }, () => {
      getContextLogger(mockLogger);
      expect(mockChild).toHaveBeenCalledWith(
        expect.not.objectContaining({ traceId: expect.anything() }),
      );
    });
  });
});
