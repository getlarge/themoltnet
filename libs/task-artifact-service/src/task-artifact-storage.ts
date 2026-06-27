import { Readable } from 'node:stream';
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

export interface TaskArtifactStorageConfig {
  TASK_ARTIFACT_STORAGE_ACCESS_KEY_ID?: string;
  TASK_ARTIFACT_STORAGE_BUCKET: string;
  TASK_ARTIFACT_STORAGE_ENDPOINT?: string;
  TASK_ARTIFACT_STORAGE_FORCE_PATH_STYLE: boolean;
  TASK_ARTIFACT_STORAGE_REGION: string;
  TASK_ARTIFACT_STORAGE_SECRET_ACCESS_KEY?: string;
}

export interface TaskArtifactObject {
  body: Readable;
  contentType?: string;
  contentEncoding?: string;
  contentLength?: number;
}

export interface TaskArtifactObjectHead {
  contentType?: string;
  contentEncoding?: string;
  contentLength?: number;
}

export interface TaskArtifactStorage {
  putObject(input: {
    key: string;
    body: Readable;
    contentLength?: number;
    contentType: string;
    contentEncoding?: string | null;
  }): Promise<void>;

  getObject(key: string): Promise<TaskArtifactObject>;

  headObject(key: string): Promise<TaskArtifactObjectHead | null>;

  deleteObject(key: string): Promise<void>;
}

export class TaskArtifactStorageNotConfiguredError extends Error {
  constructor() {
    super('Task artifact object storage is not configured');
    this.name = 'TaskArtifactStorageNotConfiguredError';
  }
}

export class MissingTaskArtifactObjectError extends Error {
  constructor(key: string) {
    super(`Task artifact object is missing: ${key}`);
    this.name = 'MissingTaskArtifactObjectError';
  }
}

export function createTaskArtifactStorage(
  config: TaskArtifactStorageConfig,
): TaskArtifactStorage {
  if (
    !config.TASK_ARTIFACT_STORAGE_ENDPOINT ||
    !config.TASK_ARTIFACT_STORAGE_ACCESS_KEY_ID ||
    !config.TASK_ARTIFACT_STORAGE_SECRET_ACCESS_KEY
  ) {
    return createDisabledTaskArtifactStorage();
  }

  const client = new S3Client({
    endpoint: config.TASK_ARTIFACT_STORAGE_ENDPOINT,
    forcePathStyle: config.TASK_ARTIFACT_STORAGE_FORCE_PATH_STYLE,
    region: config.TASK_ARTIFACT_STORAGE_REGION,
    credentials: {
      accessKeyId: config.TASK_ARTIFACT_STORAGE_ACCESS_KEY_ID,
      secretAccessKey: config.TASK_ARTIFACT_STORAGE_SECRET_ACCESS_KEY,
    },
  });
  const bucket = config.TASK_ARTIFACT_STORAGE_BUCKET;
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
          contentLength: object.ContentLength,
          contentType: object.ContentType,
        };
      } catch (err) {
        if (err instanceof NoSuchKey || hasS3NoSuchKeyName(err)) {
          throw new MissingTaskArtifactObjectError(key);
        }
        throw err;
      }
    },

    async headObject(key) {
      bucketReady ??= ensureBucket(client, bucket);
      await bucketReady;
      try {
        const object = await client.send(
          new HeadObjectCommand({
            Bucket: bucket,
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

function createDisabledTaskArtifactStorage(): TaskArtifactStorage {
  return {
    putObject() {
      return Promise.reject(new TaskArtifactStorageNotConfiguredError());
    },
    getObject() {
      return Promise.reject(new TaskArtifactStorageNotConfiguredError());
    },
    headObject() {
      return Promise.reject(new TaskArtifactStorageNotConfiguredError());
    },
    deleteObject() {
      return Promise.reject(new TaskArtifactStorageNotConfiguredError());
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
  throw new TypeError('Unsupported task artifact object body stream');
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
