import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('returns all ALS context fields', () => {
    // Arrange
    let fields: Record<string, unknown> = {};

    // Act
    runWithRequestContext(
      { requestId: 'req-123', identityId: 'id-abc', clientId: 'cl-xyz' },
      () => {
        fields = getRequestContextFields();
      },
    );

    // Assert
    expect(fields).toMatchObject({
      requestId: 'req-123',
      identityId: 'id-abc',
      clientId: 'cl-xyz',
    });
  });

  it('returns empty object outside a context', () => {
    // Act
    const fields = getRequestContextFields();

    // Assert
    expect(fields).toEqual({});
  });
});
