import { describe, expect, it } from 'vitest';

import { loadServerConfig } from '../src/config.js';

describe('loadServerConfig', () => {
  it('should apply defaults when env is empty', () => {
    const config = loadServerConfig({});
    expect(config.PORT).toBe(8080);
    expect(config.NODE_ENV).toBe('development');
    expect(config.STATIC_DIR).toBeUndefined();
  });

  it('should parse PORT from string to number', () => {
    const config = loadServerConfig({ PORT: '3000' });
    expect(config.PORT).toBe(3000);
  });

  it('should accept valid NODE_ENV values', () => {
    expect(loadServerConfig({ NODE_ENV: 'production' }).NODE_ENV).toBe(
      'production',
    );
    expect(loadServerConfig({ NODE_ENV: 'test' }).NODE_ENV).toBe('test');
    expect(loadServerConfig({ NODE_ENV: 'development' }).NODE_ENV).toBe(
      'development',
    );
  });

  it('should throw on invalid NODE_ENV', () => {
    expect(() => loadServerConfig({ NODE_ENV: 'staging' })).toThrow(
      'Invalid server config',
    );
  });

  it('should accept STATIC_DIR when provided', () => {
    const config = loadServerConfig({ STATIC_DIR: '/some/path' });
    expect(config.STATIC_DIR).toBe('/some/path');
  });

  it('should ignore empty string values', () => {
    const config = loadServerConfig({ PORT: '', NODE_ENV: '' });
    expect(config.PORT).toBe(8080);
    expect(config.NODE_ENV).toBe('development');
  });
});
