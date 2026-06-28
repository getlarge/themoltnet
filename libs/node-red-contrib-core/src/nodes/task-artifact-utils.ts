import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';

import type { NodeMessageInFlow } from 'node-red';

import type { MoltnetAgentNode } from './agent.js';
import { nonEmpty, positiveInt } from './query-utils.js';

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
): string | undefined {
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
    positiveInt(configured)
  );
}

export function requireArtifactContext(
  nodeName: string,
  msg: NodeMessageInFlow,
  configuredTaskId: unknown,
  configuredTeamId: unknown,
  agentNode: MoltnetAgentNode,
): TaskArtifactContext {
  const taskId = resolveTaskId(msg, configuredTaskId);
  if (!taskId) throw new Error(`${nodeName}: taskId is required`);
  const teamId = resolveTeamId(msg, configuredTeamId, agentNode);
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
): TaskArtifactAttemptContext {
  const context = requireArtifactContext(
    nodeName,
    msg,
    configuredTaskId,
    configuredTeamId,
    agentNode,
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

export function resolveUploadBody(msg: NodeMessageInFlow): Uint8Array {
  const payload = msg.payload;
  if (Buffer.isBuffer(payload)) return payload;
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (typeof payload === 'string') return new TextEncoder().encode(payload);

  const record = payloadRecord(msg);
  if (typeof record.contentBase64 === 'string') {
    return Buffer.from(record.contentBase64, 'base64');
  }
  const content = record.content ?? record.body;
  if (Buffer.isBuffer(content)) return content;
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (typeof content === 'string') return new TextEncoder().encode(content);

  throw new Error('task-artifact-upload: payload content is required');
}

export async function collectArtifactBody(value: unknown): Promise<Buffer> {
  const source =
    value && typeof value === 'object' && 'stream' in value
      ? (value as { stream: unknown }).stream
      : value;

  if (Buffer.isBuffer(source)) return source;
  if (source instanceof Uint8Array) return Buffer.from(source);
  if (source instanceof ArrayBuffer) return Buffer.from(source);
  if (typeof source === 'string') return Buffer.from(source);
  if (source instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of source) {
      chunks.push(toBuffer(chunk));
    }
    return Buffer.concat(chunks);
  }
  if (source && typeof source === 'object' && Symbol.asyncIterator in source) {
    const chunks: Buffer[] = [];
    for await (const chunk of source as AsyncIterable<unknown>) {
      chunks.push(toBuffer(chunk));
    }
    return Buffer.concat(chunks);
  }
  if (source && typeof source === 'object' && 'arrayBuffer' in source) {
    const arrayBuffer = await (source as Blob).arrayBuffer();
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
