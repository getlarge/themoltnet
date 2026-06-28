import type { Readable } from 'node:stream';

import { createS3CompatibleObjectStorage } from '@moltnet/blob-storage';

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

  return createS3CompatibleObjectStorage(
    {
      accessKeyId: config.TASK_ARTIFACT_STORAGE_ACCESS_KEY_ID,
      bucket: config.TASK_ARTIFACT_STORAGE_BUCKET,
      endpoint: config.TASK_ARTIFACT_STORAGE_ENDPOINT,
      forcePathStyle: config.TASK_ARTIFACT_STORAGE_FORCE_PATH_STYLE,
      region: config.TASK_ARTIFACT_STORAGE_REGION,
      secretAccessKey: config.TASK_ARTIFACT_STORAGE_SECRET_ACCESS_KEY,
    },
    {
      missingObjectError: (key) => new MissingTaskArtifactObjectError(key),
    },
  );
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
