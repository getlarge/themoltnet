import { computeBytesCidFromSha256 } from '@moltnet/crypto-service';
import { canonicalJsonBytes } from '@moltnet/crypto-service/canonical-json';
import { sha256 } from '@noble/hashes/sha2';

import {
  GUEST_SERVICE_ID_RE,
  HOST_CAPABILITY_NAME_RE,
  HOST_CAPABILITY_OPERATION_RE,
  HOST_CAPABILITY_ORIGIN_SUFFIX,
  type HostCapabilityContribution,
  type HostCapabilityDefinition,
} from './types.js';

/** Operation names core answers itself; contributions may not claim them. */
export const RESERVED_HOST_CAPABILITY_OPERATIONS: ReadonlySet<string> = new Set(
  ['identity'],
);
export const DEFAULT_HOST_CAPABILITY_MAX_BODY_BYTES = 16 * 1024;
export const DEFAULT_HOST_CAPABILITY_TIMEOUT_MS = 30_000;

export function capabilityOrigin(name: string): string {
  return `https://${name}${HOST_CAPABILITY_ORIGIN_SUFFIX}`;
}

export function normalizeGuestPath(path: string): string {
  if (!path.startsWith('/') || path.includes('\0')) {
    throw new Error(`Projected file path must be absolute: "${path}"`);
  }
  const parts: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      throw new Error(`Projected file path must not traverse: "${path}"`);
    }
    parts.push(segment);
  }
  return `/${parts.join('/')}`;
}

/** Value-free descriptor used for attestation; never includes file content. */
export function hostCapabilityDescriptor(
  def: HostCapabilityDefinition<never>,
): Record<string, unknown> {
  return {
    version: 'moltnet:host-capability:v1',
    name: def.name,
    operations: Object.fromEntries(
      Object.entries(def.operations)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, op]) => [
          name,
          {
            request: op.request,
            response: op.response,
            maxBodyBytes:
              op.maxBodyBytes ?? DEFAULT_HOST_CAPABILITY_MAX_BODY_BYTES,
            timeoutMs: op.timeoutMs ?? DEFAULT_HOST_CAPABILITY_TIMEOUT_MS,
          },
        ]),
    ),
    guest: {
      env: def.guest?.env ?? {},
      files: (def.guest?.files ?? []).map((file) => ({
        path: normalizeGuestPath(file.path),
        mode: file.mode ?? 0o644,
      })),
      services: (def.guest?.services ?? []).map((service) => ({
        id: service.id,
        command: [...service.command],
        env: service.env ?? {},
        readiness: service.readiness ?? null,
      })),
    },
  };
}

/**
 * Declare a host capability in trusted runtime code. Core validates the
 * shape once here; routing, policy, evidence and projection are generic.
 */
export function defineHostCapability<
  TInjected extends object = Record<string, unknown>,
>(
  def: HostCapabilityDefinition<TInjected>,
): HostCapabilityContribution<TInjected> {
  if (!HOST_CAPABILITY_NAME_RE.test(def.name)) {
    throw new Error(
      `Invalid host capability name "${def.name}": expected ${HOST_CAPABILITY_NAME_RE}`,
    );
  }
  const operationNames = Object.keys(def.operations);
  if (operationNames.length === 0) {
    throw new Error(
      `Host capability "${def.name}" must declare at least one operation`,
    );
  }
  for (const operation of operationNames) {
    if (!HOST_CAPABILITY_OPERATION_RE.test(operation)) {
      throw new Error(
        `Invalid operation name "${operation}" in host capability "${def.name}": expected ${HOST_CAPABILITY_OPERATION_RE}`,
      );
    }
    if (RESERVED_HOST_CAPABILITY_OPERATIONS.has(operation)) {
      throw new Error(`Operation name "${operation}" is reserved`);
    }
    const spec = def.operations[operation];
    if (typeof spec.request !== 'object' || typeof spec.response !== 'object') {
      throw new Error(
        `Operation "${operation}" in host capability "${def.name}" must declare request and response schemas`,
      );
    }
  }
  const filePaths = new Set<string>();
  for (const file of def.guest?.files ?? []) {
    const normalized = normalizeGuestPath(file.path);
    if (filePaths.has(normalized)) {
      throw new Error(
        `Duplicate projected file path "${normalized}" in "${def.name}"`,
      );
    }
    filePaths.add(normalized);
  }
  const serviceIds = new Set<string>();
  for (const service of def.guest?.services ?? []) {
    if (!GUEST_SERVICE_ID_RE.test(service.id)) {
      throw new Error(
        `Invalid guest service id "${service.id}" in "${def.name}"`,
      );
    }
    if (serviceIds.has(service.id)) {
      throw new Error(
        `Duplicate guest service id "${service.id}" in "${def.name}"`,
      );
    }
    serviceIds.add(service.id);
  }
  const descriptorCid = computeBytesCidFromSha256(
    sha256(
      canonicalJsonBytes(
        hostCapabilityDescriptor(def as HostCapabilityDefinition<never>),
      ),
    ),
  );
  return Object.freeze({
    kind: 'host_capability',
    origin: capabilityOrigin(def.name),
    descriptorCid,
    ...def,
    operations: Object.freeze({ ...def.operations }),
  });
}
