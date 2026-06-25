import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export interface RuntimeSessionStorageConfig {
  RUNTIME_SESSION_STORAGE_ACCESS_KEY_ID?: string;
  RUNTIME_SESSION_STORAGE_BUCKET: string;
  RUNTIME_SESSION_STORAGE_ENDPOINT?: string;
  RUNTIME_SESSION_STORAGE_FORCE_PATH_STYLE: boolean;
  RUNTIME_SESSION_STORAGE_REGION: string;
  RUNTIME_SESSION_STORAGE_SECRET_ACCESS_KEY?: string;
}

export interface RuntimeSessionObject {
  body: Readable;
  contentType?: string;
  contentEncoding?: string;
}

export interface RuntimeSessionStorage {
  putObject(input: {
    key: string;
    body: Readable;
    contentLength?: number;
    contentType: string;
    contentEncoding?: string | null;
  }): Promise<void>;

  getObject(key: string): Promise<RuntimeSessionObject>;

  deleteObject(key: string): Promise<void>;
}

export class RuntimeSessionStorageNotConfiguredError extends Error {
  constructor() {
    super('Runtime session object storage is not configured');
    this.name = 'RuntimeSessionStorageNotConfiguredError';
  }
}

export class MissingRuntimeSessionObjectError extends Error {
  constructor(key: string) {
    super(`Runtime session object is missing: ${key}`);
    this.name = 'MissingRuntimeSessionObjectError';
  }
}

export function createRuntimeSessionStorage(
  config: RuntimeSessionStorageConfig,
): RuntimeSessionStorage {
  if (
    !config.RUNTIME_SESSION_STORAGE_ENDPOINT ||
    !config.RUNTIME_SESSION_STORAGE_ACCESS_KEY_ID ||
    !config.RUNTIME_SESSION_STORAGE_SECRET_ACCESS_KEY
  ) {
    return createDisabledRuntimeSessionStorage();
  }

  const client = new S3Client({
    endpoint: config.RUNTIME_SESSION_STORAGE_ENDPOINT,
    forcePathStyle: config.RUNTIME_SESSION_STORAGE_FORCE_PATH_STYLE,
    region: config.RUNTIME_SESSION_STORAGE_REGION,
    credentials: {
      accessKeyId: config.RUNTIME_SESSION_STORAGE_ACCESS_KEY_ID,
      secretAccessKey: config.RUNTIME_SESSION_STORAGE_SECRET_ACCESS_KEY,
    },
  });
  const bucket = config.RUNTIME_SESSION_STORAGE_BUCKET;
  let bucketReady: Promise<void> | null = null;

  return {
    async putObject(input) {
      bucketReady ??= ensureBucket(client, bucket);
      await bucketReady;
      await client.send(
        new PutObjectCommand({
          Body: input.body,
          Bucket: bucket,
          ContentEncoding: input.contentEncoding ?? undefined,
          ContentLength: input.contentLength,
          ContentType: input.contentType,
          Key: input.key,
        }),
      );
    },

    async getObject(key) {
      bucketReady ??= ensureBucket(client, bucket);
      await bucketReady;
      try {
        const object = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
          }),
        );
        return {
          body: object.Body ? toReadable(object.Body) : Readable.from([]),
          contentEncoding: object.ContentEncoding,
          contentType: object.ContentType,
        };
      } catch (err) {
        if (err instanceof NoSuchKey || hasS3NoSuchKeyName(err)) {
          throw new MissingRuntimeSessionObjectError(key);
        }
        throw err;
      }
    },

    async deleteObject(key) {
      bucketReady ??= ensureBucket(client, bucket);
      await bucketReady;
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return;
  } catch (err) {
    if (!isBucketMissing(err)) throw err;
  }
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (err) {
    if (!isBucketAlreadyOwned(err)) throw err;
  }
}

function createDisabledRuntimeSessionStorage(): RuntimeSessionStorage {
  return {
    putObject() {
      return Promise.reject(new RuntimeSessionStorageNotConfiguredError());
    },
    getObject() {
      return Promise.reject(new RuntimeSessionStorageNotConfiguredError());
    },
    deleteObject() {
      return Promise.reject(new RuntimeSessionStorageNotConfiguredError());
    },
  };
}

function toReadable(body: unknown): Readable {
  if (body instanceof Readable) return body;
  if (
    typeof body === 'object' &&
    body !== null &&
    'transformToWebStream' in body &&
    typeof (body as { transformToWebStream?: unknown }).transformToWebStream ===
      'function'
  ) {
    return Readable.fromWeb(
      (
        body as { transformToWebStream(): NodeReadableStream }
      ).transformToWebStream(),
    );
  }
  if (
    typeof body === 'object' &&
    body !== null &&
    Symbol.asyncIterator in body
  ) {
    return Readable.from(body as AsyncIterable<Uint8Array>);
  }
  throw new TypeError('Unsupported runtime session object body stream');
}

function hasS3NoSuchKeyName(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'NoSuchKey'
  );
}

function isBucketMissing(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    ('$metadata' in err || 'name' in err) &&
    ((err as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode === 404 ||
      (err as { name?: unknown }).name === 'NotFound' ||
      (err as { name?: unknown }).name === 'NoSuchBucket')
  );
}

function isBucketAlreadyOwned(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    ((err as { name?: unknown }).name === 'BucketAlreadyOwnedByYou' ||
      (err as { name?: unknown }).name === 'BucketAlreadyExists')
  );
}
