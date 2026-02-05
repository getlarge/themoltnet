import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger, DEFAULT_REDACT_PATHS } from '../src/logger.js';

function createSinkStream(): { stream: Writable; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString().trim());
      callback();
    },
  });
  return { stream, lines };
}

describe('createLogger', () => {
  it('should return a pino logger instance', () => {
    const logger = createLogger({ serviceName: 'test-service' });
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.child).toBe('function');
  });

  it('should set the log level from config', () => {
    const logger = createLogger({
      serviceName: 'test-service',
      level: 'warn',
    });
    expect(logger.level).toBe('warn');
  });

  it('should default to info level', () => {
    const logger = createLogger({ serviceName: 'test-service' });
    expect(logger.level).toBe('info');
  });

  it('should include service name and version in base bindings', () => {
    const { stream, lines } = createSinkStream();
    const logger = createLogger({
      serviceName: 'moltnet-api',
      serviceVersion: '1.2.3',
      destination: stream,
    });
    logger.info('hello');

    // Wait for async write
    return new Promise<void>((resolve) => {
      setImmediate(() => {
        expect(lines.length).toBeGreaterThan(0);
        const record = JSON.parse(lines[0]);
        expect(record.service).toBe('moltnet-api');
        expect(record.version).toBe('1.2.3');
        expect(record.msg).toBe('hello');
        resolve();
      });
    });
  });

  it('should include environment in base bindings when provided', () => {
    const { stream, lines } = createSinkStream();
    const logger = createLogger({
      serviceName: 'test',
      environment: 'production',
      destination: stream,
    });
    logger.info('test');

    return new Promise<void>((resolve) => {
      setImmediate(() => {
        const record = JSON.parse(lines[0]);
        expect(record.environment).toBe('production');
        resolve();
      });
    });
  });

  it('should create child loggers that inherit base bindings', () => {
    const { stream, lines } = createSinkStream();
    const logger = createLogger({
      serviceName: 'test',
      destination: stream,
    });
    const child = logger.child({ component: 'diary' });
    child.info('entry created');

    return new Promise<void>((resolve) => {
      setImmediate(() => {
        const record = JSON.parse(lines[0]);
        expect(record.service).toBe('test');
        expect(record.component).toBe('diary');
        expect(record.msg).toBe('entry created');
        resolve();
      });
    });
  });

  it('should respect log level filtering', () => {
    const { stream, lines } = createSinkStream();
    const logger = createLogger({
      serviceName: 'test',
      level: 'warn',
      destination: stream,
    });
    logger.info('should not appear');
    logger.warn('should appear');

    return new Promise<void>((resolve) => {
      setImmediate(() => {
        expect(lines.length).toBe(1);
        const record = JSON.parse(lines[0]);
        expect(record.msg).toBe('should appear');
        resolve();
      });
    });
  });

  it('should serialize error objects properly', () => {
    const { stream, lines } = createSinkStream();
    const logger = createLogger({
      serviceName: 'test',
      destination: stream,
    });
    const err = new Error('something broke');
    logger.error({ err }, 'request failed');

    return new Promise<void>((resolve) => {
      setImmediate(() => {
        const record = JSON.parse(lines[0]);
        expect(record.err).toBeDefined();
        expect(record.err.message).toBe('something broke');
        expect(record.err.type).toBe('Error');
        expect(record.err.stack).toBeDefined();
        resolve();
      });
    });
  });

  describe('redaction', () => {
    it('should redact authorization header', () => {
      const { stream, lines } = createSinkStream();
      const logger = createLogger({
        serviceName: 'test',
        destination: stream,
      });
      logger.info(
        {
          req: {
            headers: {
              authorization: 'Bearer secret-token-12345',
              'content-type': 'application/json',
            },
          },
        },
        'incoming request',
      );

      return new Promise<void>((resolve) => {
        setImmediate(() => {
          const record = JSON.parse(lines[0]);
          expect(record.req.headers.authorization).toBe('[REDACTED]');
          expect(record.req.headers['content-type']).toBe('application/json');
          resolve();
        });
      });
    });

    it('should redact cookie header', () => {
      const { stream, lines } = createSinkStream();
      const logger = createLogger({
        serviceName: 'test',
        destination: stream,
      });
      logger.info(
        {
          req: {
            headers: {
              cookie: 'session=abc123; tracking=xyz789',
            },
          },
        },
        'incoming request',
      );

      return new Promise<void>((resolve) => {
        setImmediate(() => {
          const record = JSON.parse(lines[0]);
          expect(record.req.headers.cookie).toBe('[REDACTED]');
          resolve();
        });
      });
    });

    it('should redact password in request body', () => {
      const { stream, lines } = createSinkStream();
      const logger = createLogger({
        serviceName: 'test',
        destination: stream,
      });
      logger.info(
        {
          req: {
            body: {
              username: 'alice',
              password: 'super-secret-password',
            },
          },
        },
        'login attempt',
      );

      return new Promise<void>((resolve) => {
        setImmediate(() => {
          const record = JSON.parse(lines[0]);
          expect(record.req.body.username).toBe('alice');
          expect(record.req.body.password).toBe('[REDACTED]');
          resolve();
        });
      });
    });

    it('should redact x-ory-api-key header', () => {
      const { stream, lines } = createSinkStream();
      const logger = createLogger({
        serviceName: 'test',
        destination: stream,
      });
      logger.info(
        {
          req: {
            headers: {
              'x-ory-api-key': 'ory_at_secret_key',
            },
          },
        },
        'webhook call',
      );

      return new Promise<void>((resolve) => {
        setImmediate(() => {
          const record = JSON.parse(lines[0]);
          expect(record.req.headers['x-ory-api-key']).toBe('[REDACTED]');
          resolve();
        });
      });
    });

    it('should not redact when disableRedaction is true', () => {
      const { stream, lines } = createSinkStream();
      const logger = createLogger({
        serviceName: 'test',
        destination: stream,
        disableRedaction: true,
      });
      logger.info(
        {
          req: {
            headers: {
              authorization: 'Bearer visible-token',
            },
          },
        },
        'request',
      );

      return new Promise<void>((resolve) => {
        setImmediate(() => {
          const record = JSON.parse(lines[0]);
          expect(record.req.headers.authorization).toBe('Bearer visible-token');
          resolve();
        });
      });
    });
  });

  describe('DEFAULT_REDACT_PATHS', () => {
    it('should contain common sensitive paths', () => {
      expect(DEFAULT_REDACT_PATHS).toContain('req.headers.authorization');
      expect(DEFAULT_REDACT_PATHS).toContain('req.headers.cookie');
      expect(DEFAULT_REDACT_PATHS).toContain('req.headers["x-api-key"]');
      expect(DEFAULT_REDACT_PATHS).toContain('req.headers["x-ory-api-key"]');
      expect(DEFAULT_REDACT_PATHS).toContain('req.body.password');
      expect(DEFAULT_REDACT_PATHS).toContain('req.body.token');
      expect(DEFAULT_REDACT_PATHS).toContain('body.password');
    });
  });
});
