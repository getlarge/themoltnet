import { describe, expect, it } from 'vitest';

import {
  MoltNetError,
  NetworkError,
  problemToError,
  RegistrationError,
} from '../src/errors.js';

describe('MoltNetError', () => {
  it('should store code, statusCode, and detail', () => {
    const err = new MoltNetError('test', {
      code: 'TEST',
      statusCode: 400,
      detail: 'some detail',
    });

    expect(err.message).toBe('test');
    expect(err.code).toBe('TEST');
    expect(err.statusCode).toBe(400);
    expect(err.detail).toBe('some detail');
    expect(err.name).toBe('MoltNetError');
  });

  it('should be an instance of Error', () => {
    const err = new MoltNetError('test', { code: 'X' });
    expect(err).toBeInstanceOf(Error);
  });
});

describe('RegistrationError', () => {
  it('should extend MoltNetError', () => {
    const err = new RegistrationError('bad', {
      code: 'VOUCHER_INVALID',
      statusCode: 403,
    });

    expect(err).toBeInstanceOf(MoltNetError);
    expect(err).toBeInstanceOf(RegistrationError);
    expect(err.name).toBe('RegistrationError');
    expect(err.statusCode).toBe(403);
  });
});

describe('NetworkError', () => {
  it('should extend MoltNetError with NETWORK_ERROR code', () => {
    const err = new NetworkError('fetch failed', { detail: 'ECONNREFUSED' });

    expect(err).toBeInstanceOf(MoltNetError);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.detail).toBe('ECONNREFUSED');
    expect(err.statusCode).toBeUndefined();
  });
});

describe('problemToError', () => {
  it('should map ProblemDetails to RegistrationError', () => {
    const err = problemToError(
      {
        type: 'urn:moltnet:problem:voucher-invalid',
        title: 'Invalid voucher',
        status: 403,
        code: 'VOUCHER_INVALID',
        detail: 'Voucher has already been redeemed',
      },
      403,
    );

    expect(err).toBeInstanceOf(RegistrationError);
    expect(err.message).toBe('Invalid voucher');
    expect(err.code).toBe('urn:moltnet:problem:voucher-invalid');
    expect(err.statusCode).toBe(403);
    expect(err.detail).toBe('Voucher has already been redeemed');
  });

  it('should use defaults when fields are missing', () => {
    const err = problemToError(
      {
        type: '',
        title: '',
        status: 500,
        code: 'INTERNAL',
      } as never,
      500,
    );

    expect(err.statusCode).toBe(500);
  });
});
