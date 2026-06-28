import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';

import type { NodeMessageInFlow } from 'node-red';

import type { MoltnetAgentNode } from './agent.js';
import { nonEmpty, positiveInt } from './query-utils.js';

export const DEFAULT_TASK_ARTIFACT_MAX_BYTES = 25 * 1024 * 1024;

export interface TaskArtifactContext {
  taskId: string;
  teamId: string;
}

export interface TaskArtifactAttemptContext extends TaskArtifactContext {
  attemptN: number;
}

export function payloadRecord(msg: NodeMessageInFlow): Record<string, unknown> {
  if (!msg.payload || typeof msg.payload !== 'object') return {};
  if (Buffer.isBuffer(msg.payload)) return {};
  return msg.payload as Record<string, unknown>;
}

export function resolveTaskId(
  msg: NodeMessageInFlow,
  configured: unknown,
): string | undefined {
  if (typeof msg.taskId === 'string' && msg.taskId) return msg.taskId;
  const payload = payloadRecord(msg);
  const fromPayload =
    nonEmpty(payload.taskId) ??
    nonEmpty(payload.id) ??
    nonEmpty(recordField(payload.task, 'id'));
  return fromPayload ?? nonEmpty(configured);
}

export function resolveTeamId(
  msg: NodeMessageInFlow,
  configured: unknown,
  agentNode: MoltnetAgentNode,
  allowMsgTeamOverride: boolean,
): string | undefined {
  if (!allowMsgTeamOverride) {
    return nonEmpty(configured) ?? agentNode.teamId;
  }
  if (typeof msg.teamId === 'string' && msg.teamId) return msg.teamId;
  const payload = payloadRecord(msg);
  return nonEmpty(payload.teamId) ?? nonEmpty(configured) ?? agentNode.teamId;
}

export function resolveAttemptN(
  msg: NodeMessageInFlow,
  configured: unknown,
): number | undefined {
  const payload = payloadRecord(msg);
  return (
    positiveInt(msg.attemptN) ??
    positiveInt(payload.attemptN) ??
    positiveInt(recordField(payload.attempt, 'attemptN')) ??
    positiveInt(recordField(payload.artifact, 'attemptN')) ??
    positiveInt(configured)
  );
}

export function requireArtifactContext(
  nodeName: string,
  msg: NodeMessageInFlow,
  configuredTaskId: unknown,
  configuredTeamId: unknown,
  agentNode: MoltnetAgentNode,
  allowMsgTeamOverride: boolean,
): TaskArtifactContext {
  const taskId = resolveTaskId(msg, configuredTaskId);
  if (!taskId) throw new Error(`${nodeName}: taskId is required`);
  const teamId = resolveTeamId(
    msg,
    configuredTeamId,
    agentNode,
    allowMsgTeamOverride,
  );
  if (!teamId) throw new Error(`${nodeName}: teamId is required`);
  return { taskId, teamId };
}

export function requireAttemptContext(
  nodeName: string,
  msg: NodeMessageInFlow,
  configuredTaskId: unknown,
  configuredTeamId: unknown,
  configuredAttemptN: unknown,
  agentNode: MoltnetAgentNode,
  allowMsgTeamOverride: boolean,
): TaskArtifactAttemptContext {
  const context = requireArtifactContext(
    nodeName,
    msg,
    configuredTaskId,
    configuredTeamId,
    agentNode,
    allowMsgTeamOverride,
  );
  const attemptN = resolveAttemptN(msg, configuredAttemptN);
  if (!attemptN) throw new Error(`${nodeName}: attemptN is required`);
  return { ...context, attemptN };
}

export function resolveField(
  msg: NodeMessageInFlow,
  name: string,
  configured: unknown,
): string | undefined {
  const payload = payloadRecord(msg);
  return nonEmpty(payload[name]) ?? nonEmpty(configured);
}

export function resolveMaxBytes(configured: unknown): number {
  return positiveInt(configured) ?? DEFAULT_TASK_ARTIFACT_MAX_BYTES;
}

export function resolveUploadBody(
  msg: NodeMessageInFlow,
  maxBytes: number,
): Uint8Array {
  const payload = msg.payload;
  if (Buffer.isBuffer(payload)) return enforceMaxBytes(payload, maxBytes);
  if (payload instanceof Uint8Array) return enforceMaxBytes(payload, maxBytes);
  if (payload instanceof ArrayBuffer) {
    if (payload.byteLength > maxBytes) throw tooLarge('upload', maxBytes);
    return new Uint8Array(payload);
  }
  if (typeof payload === 'string') {
    if (Buffer.byteLength(payload) > maxBytes)
      throw tooLarge('upload', maxBytes);
    return new TextEncoder().encode(payload);
  }

  const record = payloadRecord(msg);
  if (typeof record.contentBase64 === 'string') {
    const normalized = record.contentBase64.replace(/\s/g, '');
    if (decodedBase64Length(normalized) > maxBytes) {
      throw tooLarge('upload', maxBytes);
    }
    return Buffer.from(normalized, 'base64');
  }
  const content = record.content ?? record.body;
  if (Buffer.isBuffer(content)) return enforceMaxBytes(content, maxBytes);
  if (content instanceof Uint8Array) return enforceMaxBytes(content, maxBytes);
  if (content instanceof ArrayBuffer) {
    if (content.byteLength > maxBytes) throw tooLarge('upload', maxBytes);
    return new Uint8Array(content);
  }
  if (typeof content === 'string') {
    if (Buffer.byteLength(content) > maxBytes)
      throw tooLarge('upload', maxBytes);
    return new TextEncoder().encode(content);
  }

  throw new Error('task-artifact-upload: payload content is required');
}

export async function collectArtifactBody(
  value: unknown,
  maxBytes: number,
): Promise<Buffer> {
  const source =
    value && typeof value === 'object' && 'stream' in value
      ? (value as { stream: unknown }).stream
      : value;

  if (Buffer.isBuffer(source)) {
    if (source.byteLength > maxBytes) throw tooLarge('download', maxBytes);
    return source;
  }
  if (source instanceof Uint8Array) {
    if (source.byteLength > maxBytes) throw tooLarge('download', maxBytes);
    return Buffer.from(source);
  }
  if (source instanceof ArrayBuffer) {
    if (source.byteLength > maxBytes) throw tooLarge('download', maxBytes);
    return Buffer.from(source);
  }
  if (typeof source === 'string') {
    if (Buffer.byteLength(source) > maxBytes)
      throw tooLarge('download', maxBytes);
    return Buffer.from(source);
  }
  if (source instanceof Readable) {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of source) {
      bytes = pushChunk(chunks, chunk, bytes, maxBytes);
    }
    return Buffer.concat(chunks);
  }
  if (source && typeof source === 'object' && Symbol.asyncIterator in source) {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of source as AsyncIterable<unknown>) {
      bytes = pushChunk(chunks, chunk, bytes, maxBytes);
    }
    return Buffer.concat(chunks);
  }
  if (source && typeof source === 'object' && 'arrayBuffer' in source) {
    const size = (source as { size?: unknown }).size;
    if (typeof size === 'number' && size > maxBytes) {
      throw tooLarge('download', maxBytes);
    }
    const arrayBuffer = await (source as Blob).arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) throw tooLarge('download', maxBytes);
    return Buffer.from(arrayBuffer);
  }

  throw new Error('task-artifact-download: unsupported artifact body');
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value);
  return Buffer.from(String(value));
}

export function recordField(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  return (value as Record<string, unknown>)[key];
}

function enforceMaxBytes<T extends Uint8Array>(value: T, maxBytes: number): T {
  if (value.byteLength > maxBytes) throw tooLarge('upload', maxBytes);
  return value;
}

function pushChunk(
  chunks: Buffer[],
  chunk: unknown,
  bytes: number,
  maxBytes: number,
): number {
  const next = toBuffer(chunk);
  const total = bytes + next.byteLength;
  if (total > maxBytes) throw tooLarge('download', maxBytes);
  chunks.push(next);
  return total;
}

function decodedBase64Length(value: string): number {
  if (!value) return 0;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

function tooLarge(operation: 'upload' | 'download', maxBytes: number): Error {
  return new Error(
    `task-artifact-${operation}: artifact body exceeds ${maxBytes} bytes`,
  );
}
