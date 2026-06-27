import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';

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
