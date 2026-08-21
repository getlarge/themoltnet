/**
 * Enforcement states a runtime component may truthfully report for one
 * control. These never collapse into a single coverage flag.
 *
 * - `enforced`: the control is active and the adapter can observe it.
 * - `unsupported`: the adapter cannot express the control at all.
 * - `degraded`: the control was preferred, the adapter lost it, execution
 *   continued with weaker assurance.
 * - `failed-open`: the control was expected to be active, the adapter lost it,
 *   and execution continued without it. This is the worst state short of
 *   `failed`, and it is never silently reported as `enforced`.
 * - `failed`: a required control could not be applied; launch or the session
 *   stopped.
 */
export type EnforcementState =
  | 'enforced'
  | 'unsupported'
  | 'degraded'
  | 'failed-open'
  | 'failed';

export const ENFORCEMENT_STATES: readonly EnforcementState[] = Object.freeze([
  'enforced',
  'unsupported',
  'degraded',
  'failed-open',
  'failed',
]);

/** How strongly a profile asks for a capability. */
export type RequirementLevel = 'required' | 'preferred';

/**
 * Where a control is applied. A guest sandbox cannot prove control over host
 * MCP, provider UI methods, or host exec; those are `outside-containment`
 * unless a host broker mediates them.
 */
export type EnforcementLocus =
  | 'guest-sandbox'
  | 'host-broker'
  | 'coding-agent-hook'
  | 'outside-containment';

/**
 * Map a lost or absent control to the honest state for the declared
 * requirement. Disappearance is never presented as `enforced`.
 */
export function stateForUnavailableControl(
  requested: RequirementLevel | 'none',
  declared: EnforcementState,
): EnforcementState {
  if (requested === 'required') return 'failed';
  if (requested === 'preferred') return 'degraded';
  // Not requested: only a previously active control can fail open.
  return declared === 'enforced' ? 'failed-open' : declared;
}

export function isEnforcementState(value: unknown): value is EnforcementState {
  return (
    typeof value === 'string' &&
    (ENFORCEMENT_STATES as readonly string[]).includes(value)
  );
}
