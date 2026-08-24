import type { AgentIdentity } from '@moltnet/crypto-service/agent-signing';
import type { Agent } from '@themoltnet/sdk';
import type { TSchema } from 'typebox';

export const HOST_CAPABILITY_ORIGIN_SUFFIX = '.moltnet.internal';
export const HOST_CAPABILITY_NAME_RE = /^[a-z][a-z0-9-]{1,62}$/;
export const HOST_CAPABILITY_OPERATION_RE = /^[a-z][a-z0-9-]{0,62}$/;
export const GUEST_SERVICE_ID_RE = /^[a-z][a-z0-9-]{0,62}$/;

/**
 * Capability-neutral request context. Capability-specific state (a signer, a
 * provider client, …) is injected by the daemon at router construction and
 * reaches a contribution only through `injected`, typed by the contribution.
 */
export interface HostCapabilityContext<
  TInjected extends object = Record<string, unknown>,
> {
  taskId: string;
  attemptN: number;
  teamId: string;
  /** Host-side authenticated Agent. */
  agent: Agent;
  /** Non-secret identity of the agent this daemon runs as. */
  identity: AgentIdentity;
  /** Aborted on timeout or attempt cancellation; handlers must honour it. */
  signal: AbortSignal;
  injected: TInjected;
}

export interface HostCapabilityOperation<
  I = unknown,
  O = unknown,
  TInjected extends object = Record<string, unknown>,
> {
  /** Closed TypeBox schema validated by core before `handle` runs. */
  request: TSchema;
  response: TSchema;
  handle(input: I, ctx: HostCapabilityContext<TInjected>): Promise<O>;
  /** Value-free fields core attaches to the evidence record. */
  evidence(input: I): Record<string, string | number>;
  /** Maximum request body size in bytes (default 16 KiB). */
  maxBodyBytes?: number;
  /** Per-call deadline in milliseconds (default 30 s). */
  timeoutMs?: number;
}

export interface GuestProjectionFileSpec {
  path: string;
  mode?: number;
  /** Rendered per session; content never enters the attested descriptor. */
  content: (
    identity: AgentIdentity,
    paths: { mountPath: string },
  ) => string | Uint8Array;
}

export interface GuestProjectionFile {
  path: string;
  content: string | Uint8Array;
  mode?: number;
}

export interface GuestProjectionService {
  id: string;
  command: readonly string[];
  env?: Record<string, string>;
  /**
   * The sandbox waits for this guest path before the session starts. When
   * `required` is true a missing path fails the session; otherwise it degrades
   * with a diagnostic and the session continues.
   */
  readiness?: { path: string; timeoutMs?: number; required?: boolean };
}

export interface GuestProjection {
  env: Record<string, string>;
  files: GuestProjectionFile[];
  services: GuestProjectionService[];
}

export interface HostCapabilityDefinition<
  TInjected extends object = Record<string, unknown>,
> {
  /** DNS label; the origin is `https://<name>.moltnet.internal`. */
  name: string;
  operations: Record<
    string,
    HostCapabilityOperation<never, unknown, TInjected>
  >;
  guest?: {
    /** `${origin}` expands to the capability origin. */
    env?: Record<string, string>;
    files?: GuestProjectionFileSpec[];
    services?: GuestProjectionService[];
  };
}

export interface HostCapabilityContribution<
  TInjected extends object = Record<string, unknown>,
> extends Readonly<HostCapabilityDefinition<TInjected>> {
  readonly kind: 'host_capability';
  readonly origin: string;
  /**
   * Content address of the value-free descriptor: operation schemas and
   * limits, guest env, projected file paths/modes, service commands and
   * readiness. Any change to the guest-facing protocol changes it.
   */
  readonly descriptorCid: string;
}

/** Served in-process by the sandbox proxy for one origin. */
export type HostOriginHandler = (request: Request) => Promise<Response>;

export interface HostCapabilityManifestEntry {
  name: string;
  origin: string;
  operations: string[];
  descriptorCid: string;
}
