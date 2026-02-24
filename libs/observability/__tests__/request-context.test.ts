import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @opentelemetry/api before importing the module under test
vi.mock('@opentelemetry/api', () => ({
  trace: {
    getActiveSpan: vi.fn(),
  },
}));

import { trace } from '@opentelemetry/api';

import {
  getRequestContextFields,
  runWithRequestContext,
  setRequestContextField,
} from '../src/request-context.js';

describe('runWithRequestContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('makes requestId available to getRequestContextFields within the callback', () => {
    // Arrange
    const requestId = 'req-123';
    let fields: Record<string, unknown> = {};

    // Act
    runWithRequestContext({ requestId }, () => {
      fields = getRequestContextFields();
    });

    // Assert
    expect(fields).toMatchObject({ requestId });
  });

  it('does not leak context outside the callback', () => {
    // Arrange + Act
    runWithRequestContext({ requestId: 'req-leak' }, () => {});
    const fields = getRequestContextFields();

    // Assert
    expect(fields).not.toMatchObject({ requestId: 'req-leak' });
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
    let fields: Record<string, unknown> = {};

    // Act
    runWithRequestContext({ requestId }, () => {
      setRequestContextField('identityId', identityId);
      fields = getRequestContextFields();
    });

    // Assert
    expect(fields).toMatchObject({ requestId, identityId });
  });

  it('is a no-op when called outside a context', () => {
    // Act + Assert (nothing to arrange, nothing to capture)
    expect(() => setRequestContextField('identityId', 'orphan')).not.toThrow();
  });
});

describe('getRequestContextFields', () => {
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
    let fields: Record<string, unknown> = {};

    // Act
    runWithRequestContext({ requestId: 'req-otel' }, () => {
      fields = getRequestContextFields();
    });

    // Assert
    expect(fields).toMatchObject({ traceId: 'trace-111', spanId: 'span-222' });
  });

  it('omits traceId when no active span', () => {
    // Arrange
    vi.mocked(trace.getActiveSpan).mockReturnValue(undefined);
    let fields: Record<string, unknown> = {};

    // Act
    runWithRequestContext({ requestId: 'req-notrace' }, () => {
      fields = getRequestContextFields();
    });

    // Assert
    expect(fields).not.toHaveProperty('traceId');
  });
});
