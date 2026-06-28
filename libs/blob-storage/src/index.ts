import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export interface StagedBlobUpload {
  path: string;
  sha256: string;
  sha256Bytes: Uint8Array;
  sizeBytes: number;
  dispose(): Promise<void>;
}

export interface StageReadableToTempFileInput {
  body: unknown;
  fileName: string;
  maxBytes: number;
  transforms?: NodeJS.ReadWriteStream[];
  tmpPrefix: string;
}

export interface S3CompatibleObjectStorageConfig {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  forcePathStyle: boolean;
  region: string;
  secretAccessKey: string;
}

export interface BlobObject {
  body: Readable;
  contentEncoding?: string;
  contentLength?: number;
  contentType?: string;
}

export interface BlobObjectHead {
  contentEncoding?: string;
  contentLength?: number;
  contentType?: string;
}

export interface BlobObjectStorage {
  putObject(input: {
    key: string;
    body: Readable;
    contentLength?: number;
    contentType: string;
    contentEncoding?: string | null;
  }): Promise<void>;

  getObject(key: string): Promise<BlobObject>;

  headObject(key: string): Promise<BlobObjectHead | null>;

  deleteObject(key: string): Promise<void>;
}

export interface CreateS3CompatibleObjectStorageOptions {
  missingObjectError(key: string): Error;
}

export class BlobTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Blob exceeds ${maxBytes} bytes`);
    this.name = 'BlobTooLargeError';
  }
}

export class BlobBodyNotReadableError extends Error {
  constructor() {
    super('Blob body must be a readable stream');
    this.name = 'BlobBodyNotReadableError';
  }
}

export function createS3CompatibleObjectStorage(
  config: S3CompatibleObjectStorageConfig,
  options: CreateS3CompatibleObjectStorageOptions,
): BlobObjectStorage {
  const client = new S3Client({
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  let bucketReady: Promise<void> | null = null;

  async function requireBucketReady(): Promise<void> {
    bucketReady ??= ensureBucket(client, config.bucket).catch((err) => {
      bucketReady = null;
      throw err;
    });
    await bucketReady;
  }

  return {
    async putObject(input) {
      await requireBucketReady();
      await client.send(
        new PutObjectCommand({
          Body: input.body,
          Bucket: config.bucket,
          ContentEncoding: input.contentEncoding ?? undefined,
          ContentLength: input.contentLength,
          ContentType: input.contentType,
          Key: input.key,
        }),
      );
    },

    async getObject(key) {
      await requireBucketReady();
      try {
        const object = await client.send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: key,
          }),
        );
        return {
          body: object.Body ? toReadable(object.Body) : Readable.from([]),
          contentEncoding: object.ContentEncoding,
          contentLength: object.ContentLength,
          contentType: object.ContentType,
        };
      } catch (err) {
        if (err instanceof NoSuchKey || hasS3NoSuchKeyName(err)) {
          throw options.missingObjectError(key);
        }
        throw err;
      }
    },

    async headObject(key) {
      await requireBucketReady();
      try {
        const object = await client.send(
          new HeadObjectCommand({
            Bucket: config.bucket,
            Key: key,
          }),
        );
        return {
          contentEncoding: object.ContentEncoding,
          contentLength: object.ContentLength,
          contentType: object.ContentType,
        };
      } catch (err) {
        if (err instanceof NotFound || hasS3NoSuchKeyName(err)) {
          return null;
        }
        throw err;
      }
    },

    async deleteObject(key) {
      await requireBucketReady();
      await client.send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
      );
    },
  };
}

export async function stageReadableToTempFile(
  input: StageReadableToTempFileInput,
): Promise<StagedBlobUpload> {
  if (!isReadableStream(input.body)) {
    throw new BlobBodyNotReadableError();
  }

  const dir = await mkdtemp(join(tmpdir(), input.tmpPrefix));
  const path = join(dir, input.fileName);
  const rawLimit = new ByteLimitTransform(input.maxBytes);
  const hashAndCount = new HashAndCountTransform();

  try {
    await pipeline(
      input.body,
      rawLimit,
      ...(input.transforms ?? []),
      hashAndCount,
      createWriteStream(path),
    );
  } catch (err) {
    await rm(dir, { force: true, recursive: true });
    throw err;
  }

  const sha256Bytes = hashAndCount.digest();
  return {
    path,
    sha256: Buffer.from(sha256Bytes).toString('hex'),
    sha256Bytes,
    sizeBytes: hashAndCount.bytes,
    dispose: () => rm(dir, { force: true, recursive: true }),
  };
}

export function isReadableStream(
  value: unknown,
): value is NodeJS.ReadableStream {
  return (
    typeof value === 'object' &&
    value !== null &&
    'pipe' in value &&
    typeof (value as { pipe?: unknown }).pipe === 'function'
  );
}

class ByteLimitTransform extends Transform {
  bytes = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ) {
    this.bytes += chunk.byteLength;
    if (this.bytes > this.maxBytes) {
      callback(new BlobTooLargeError(this.maxBytes));
      return;
    }
    callback(null, chunk);
  }
}

class HashAndCountTransform extends Transform {
  private readonly hash = createHash('sha256');
  bytes = 0;

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ) {
    this.bytes += chunk.byteLength;
    this.hash.update(chunk);
    callback(null, chunk);
  }

  digest(): Uint8Array {
    return this.hash.digest();
  }
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
  throw new TypeError('Unsupported object body stream');
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
