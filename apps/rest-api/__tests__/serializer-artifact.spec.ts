import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import {
  createPrecompiledSerializerFactory,
  createSerializerArtifactBuilder,
  loadSerializerArtifact,
  type SerializerArtifact,
} from '../src/serializer-artifact.js';
import { createSerializerCompilerFactory } from '../src/serializer-compiler.js';

const route = { method: 'GET', url: '/', httpStatus: '200' };
const require = createRequire(import.meta.url);

function restore(source: string): SerializerArtifact {
  const module = { exports: {} };
  runInNewContext(source, { require, module });
  return module.exports as SerializerArtifact;
}

describe('precompiled response serializers', () => {
  it('preserves filtering, required fields, references, arrays and union behavior', () => {
    const schemas = {
      Item: {
        $id: 'Item',
        type: 'object',
        properties: {
          name: { type: 'string' },
          value: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
        },
        required: ['name'],
      },
    };
    const responseSchemas = [
      schemas.Item,
      { $ref: 'Item' },
      { type: 'array', items: { $ref: 'Item' } },
    ];
    const builder = createSerializerArtifactBuilder();
    const generate = builder.factory(schemas);
    for (const schema of responseSchemas) generate({ ...route, schema });
    const compiled = createPrecompiledSerializerFactory(
      restore(builder.source()),
    )(schemas);
    const runtime = createSerializerCompilerFactory()(schemas);
    const objects = [
      { name: 'a', value: 2, secret: 'hidden' },
      { name: 'b', value: null },
      { name: 'c' },
      { value: 1 },
    ];
    for (const schema of responseSchemas) {
      const expected = runtime({ ...route, schema });
      const actual = compiled({ ...route, schema });
      for (const object of objects) {
        const value = schema === responseSchemas[2] ? [object] : object;
        if (!('name' in object)) {
          expect(() => expected(value)).toThrow();
          expect(() => actual(value)).toThrow();
        } else {
          expect(actual(value)).toBe(expected(value));
          expect(actual(value)).not.toContain('secret');
        }
      }
    }
  });

  it('isolates plugin scopes and serializer options', () => {
    const integer = { Value: { $id: 'Value', type: 'integer' } };
    const string = { Value: { $id: 'Value', type: 'string' } };
    const response = { ...route, schema: { $ref: 'Value' } };
    const builder = createSerializerArtifactBuilder();
    builder.factory(integer, { rounding: 'floor' })(response);
    builder.factory(integer, { rounding: 'ceil' })(response);
    builder.factory(string)(response);
    const compile = createPrecompiledSerializerFactory(
      restore(builder.source()),
    );
    expect(compile(integer, { rounding: 'floor' })(response)(1.8)).toBe('1');
    expect(compile(integer, { rounding: 'ceil' })(response)(1.8)).toBe('2');
    expect(compile(string)(response)('text')).toBe('"text"');
  });

  it('fails closed when a schema, reference or option changes', () => {
    const schema = { type: 'string' };
    const builder = createSerializerArtifactBuilder();
    builder.factory({})({ ...route, schema });
    const compile = createPrecompiledSerializerFactory(
      restore(builder.source()),
    );
    expect(() => compile({ Added: { type: 'number' } })).toThrow(
      'scope mismatch',
    );
    expect(() => compile({}, { rounding: 'ceil' })).toThrow('scope mismatch');
    expect(() => compile({})({ ...route, schema: { type: 'number' } })).toThrow(
      'Missing precompiled serializer',
    );
    expect(() =>
      createPrecompiledSerializerFactory({ version: 2 } as never),
    ).toThrow('Unsupported serializer artifact version');
  });

  it('rejects options that cannot be safely fingerprinted', () => {
    const builder = createSerializerArtifactBuilder();
    expect(() => builder.factory({}, { custom: () => 'x' } as never)).toThrow(
      'JSON-compatible options',
    );
    expect(() => builder.factory({}, { custom: /x/ } as never)).toThrow(
      'JSON-compatible options',
    );
    expect(() => builder.factory({}, { custom: new Date() } as never)).toThrow(
      'JSON-compatible options',
    );
  });

  it('does not fall back to runtime compilation when the artifact is missing', () => {
    expect(() =>
      loadSerializerArtifact(
        new URL('./missing-serializers.cjs', import.meta.url),
      ),
    ).toThrow('Cannot find module');
  });

  it('serves the same filtered responses from an actual Fastify route', async () => {
    const builder = createSerializerArtifactBuilder();
    const schema = {
      type: 'object',
      properties: { public: { type: 'string' } },
      required: ['public'],
    };
    const register = (app: FastifyInstance) => {
      app.get('/', { schema: { response: { 200: schema } } }, async () => ({
        public: 'visible',
        secret: 'hidden',
      }));
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
    };
    const generator = Fastify({
      schemaController: {
        compilersFactory: { buildSerializer: builder.factory },
      },
    });
    register(generator);
    try {
      await generator.ready();
    } finally {
      await generator.close();
    }
    const app = Fastify({
      schemaController: {
        compilersFactory: {
          buildSerializer: createPrecompiledSerializerFactory(
            restore(builder.source()),
          ),
        },
      },
    });
    register(app);
    try {
      const response = await app.inject('/');
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('{"public":"visible"}');
      expect((await app.inject('/left')).json()).toEqual({ left: 'L' });
      expect((await app.inject('/right')).json()).toEqual({ right: 'R' });
    } finally {
      await app.close();
    }
  });
});
