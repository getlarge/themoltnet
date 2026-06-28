import type { Readable } from 'node:stream';

import { createS3CompatibleObjectStorage } from '@moltnet/blob-storage';

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

  const storage = createS3CompatibleObjectStorage(
    {
      accessKeyId: config.RUNTIME_SESSION_STORAGE_ACCESS_KEY_ID,
      bucket: config.RUNTIME_SESSION_STORAGE_BUCKET,
      endpoint: config.RUNTIME_SESSION_STORAGE_ENDPOINT,
      forcePathStyle: config.RUNTIME_SESSION_STORAGE_FORCE_PATH_STYLE,
      region: config.RUNTIME_SESSION_STORAGE_REGION,
      secretAccessKey: config.RUNTIME_SESSION_STORAGE_SECRET_ACCESS_KEY,
    },
    {
      missingObjectError: (key) => new MissingRuntimeSessionObjectError(key),
    },
  );

  return {
    putObject: (input) => storage.putObject(input),
    getObject: (key) => storage.getObject(key),
    deleteObject: (key) => storage.deleteObject(key),
  };
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
