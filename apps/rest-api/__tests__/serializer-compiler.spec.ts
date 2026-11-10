import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { createSerializerCompilerFactory } from '../src/serializer-compiler.js';

const problem = {
  $id: 'Problem',
  type: 'object',
  properties: { title: { type: 'string' } },
  required: ['title'],
};

describe('response serializer reuse', () => {
  it('preserves shared references after compiling a schema with its own $id', () => {
    const compile = createSerializerCompilerFactory()({ Problem: problem });
    const route = { method: 'GET', url: '/', httpStatus: '200' };
    const direct = compile({ ...route, schema: problem });
    const referenced = compile({ ...route, schema: { $ref: 'Problem' } });
    expect(direct({ title: 'test' })).toBe('{"title":"test"}');
    expect(referenced({ title: 'test' })).toBe('{"title":"test"}');
  });

  it('reuses equivalent schemas across routes and equivalent scopes', () => {
    const build = createSerializerCompilerFactory();
    const first = build({ Problem: problem });
    const second = build({ Problem: { ...problem } });
    const serialize = first({
      schema: { $ref: 'Problem' },
      method: 'GET',
      url: '/a',
      httpStatus: '400',
    });
    expect(
      second({
        schema: { $ref: 'Problem' },
        method: 'POST',
        url: '/b',
        httpStatus: '500',
      }),
    ).toBe(serialize);
    expect(serialize({ title: 'Bad request', privateField: 'hidden' })).toBe(
      '{"title":"Bad request"}',
    );
    expect(() => serialize({})).toThrow();
  });

  it('isolates reference definitions, serializer options and app instances', () => {
    const build = createSerializerCompilerFactory();
    const route = {
      schema: { $ref: 'Value' },
      method: 'GET',
      url: '/',
      httpStatus: '200',
    };
    const integer = { Value: { $id: 'Value', type: 'integer' } };
    const floor = build(integer, { rounding: 'floor' })(route);
    const ceil = build(integer, { rounding: 'ceil' })(route);
    const string = build({ Value: { $id: 'Value', type: 'string' } })(route);
    expect(floor(1.8)).toBe('1');
    expect(ceil(1.8)).toBe('2');
    expect(string('text')).toBe('"text"');
    expect(createSerializerCompilerFactory()(integer)(route)).not.toBe(floor);
  });

  it('keeps plugin-local references and response filtering intact', async () => {
    const app = Fastify({
      schemaController: {
        compilersFactory: {
          buildSerializer: createSerializerCompilerFactory(),
        },
      },
    });
    for (const field of ['left', 'right']) {
      app.register(async (child) => {
        child.addSchema({
          $id: 'Scoped',
          type: 'object',
          properties: { [field]: { type: 'string' } },
        });
        child.get(
          `/${field}`,
          { schema: { response: { 200: { $ref: 'Scoped' } } } },
          async () => ({ left: 'L', right: 'R', secret: 'hidden' }),
        );
      });
    }
    try {
      expect((await app.inject('/left')).json()).toEqual({ left: 'L' });
      expect((await app.inject('/right')).json()).toEqual({ right: 'R' });
    } finally {
      await app.close();
    }
  });
});
