import { describe, expect, it } from 'vitest';

import { argumentValue, databaseUrlForProxy } from './database-proxy-url.js';

describe('database proxy URL', () => {
  it('leaves the database URL unchanged when no proxy port is requested', () => {
    const url = 'postgres://user:secret@prod.internal:5432/app?sslmode=require';

    expect(databaseUrlForProxy(url, undefined)).toBe(url);
  });

  it('rewrites only the host, port, and SSL mode for a host-local proxy', () => {
    const result = databaseUrlForProxy(
      'postgresql://user:secret@prod.internal:5432/app?application_name=backfill&sslmode=require',
      '15432',
    );

    const url = new URL(result);
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.port).toBe('15432');
    expect(url.username).toBe('user');
    expect(url.password).toBe('secret');
    expect(url.pathname).toBe('/app');
    expect(url.searchParams.get('application_name')).toBe('backfill');
    expect(url.searchParams.get('sslmode')).toBe('disable');
  });

  it.each(['0', '65536', '1.5', 'abc', '-1'])(
    'rejects unsafe proxy port %s',
    (port) => {
      expect(() =>
        databaseUrlForProxy('postgres://user:secret@prod/app', port),
      ).toThrow('--database-proxy-port');
    },
  );

  it('rejects non-Postgres URLs', () => {
    expect(() =>
      databaseUrlForProxy('https://prod.internal/app', '15432'),
    ).toThrow('postgres:// or postgresql://');
  });
});

describe('argument value parsing', () => {
  it('reads a single option value', () => {
    expect(
      argumentValue(
        ['--apply', '--database-proxy-port', '15432'],
        '--database-proxy-port',
      ),
    ).toBe('15432');
  });

  it('rejects missing and duplicate values', () => {
    expect(() =>
      argumentValue(['--database-proxy-port'], '--database-proxy-port'),
    ).toThrow('requires a value');
    expect(() =>
      argumentValue(
        ['--database-proxy-port', '15432', '--database-proxy-port', '15433'],
        '--database-proxy-port',
      ),
    ).toThrow('only be specified once');
  });
});
