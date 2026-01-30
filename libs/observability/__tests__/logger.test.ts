import { describe, it, expect, beforeEach } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger } from '../src/logger.js';

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
});
