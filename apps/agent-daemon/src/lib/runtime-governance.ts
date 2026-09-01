import type { ExecutionCapabilityOffer } from '@moltnet/execution-plan';

import type { PreparedDaemonRuntime } from '../runtime.js';

type ExecutionOfferFactory = (
  executorFingerprint: string,
) => ExecutionCapabilityOffer;

const executionOffers = new WeakMap<
  PreparedDaemonRuntime,
  ExecutionOfferFactory
>();

/** Attach private governance metadata without widening the public adapter API. */
export function registerRuntimeExecutionOffer(
  runtime: PreparedDaemonRuntime,
  factory: ExecutionOfferFactory,
): void {
  executionOffers.set(runtime, factory);
}

/** Resolve the selected runtime's offer for the observe-only orchestrator. */
export function runtimeExecutionOffer(
  runtime: PreparedDaemonRuntime,
  executorFingerprint: string,
): ExecutionCapabilityOffer | undefined {
  return executionOffers.get(runtime)?.(executorFingerprint);
}
