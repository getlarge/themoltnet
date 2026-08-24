export type HostCapabilityEnforcement = 'off' | 'watch' | 'enforce';

export interface HostCapabilityPolicy {
  enforcement: HostCapabilityEnforcement;
  /** The session tool allow-set; capability grants live in it under `capability:`. */
  allowedTools: ReadonlySet<string>;
}

export type HostCapabilityDecision =
  | {
      allow: true;
      reasonCode: 'policy_off' | 'capability_allowed' | 'operation_allowed';
    }
  | {
      allow: false;
      reasonCode: 'policy_not_ready' | 'capability_not_permitted';
      reason: string;
    };

/**
 * Grant names for one operation: the broad grant covers every operation of
 * the capability, the narrow one exactly this operation.
 */
export function capabilityGrantNames(
  name: string,
  operation: string,
): [broad: string, narrow: string] {
  return [`capability:${name}`, `capability:${name}:${operation}`];
}

/**
 * Decide one host-capability request. Unlike the Pi tool gate this never
 * sees a shell command and has no executor-protocol bypass: a capability is
 * permitted only by an explicit grant. `watch` denials are reported as
 * `capability_not_permitted`; the router decides to audit-and-allow.
 */
export function decideHostCapabilityCall(input: {
  capability: string;
  operation: string;
  policy?: HostCapabilityPolicy;
}): HostCapabilityDecision {
  if (!input.policy) {
    return {
      allow: false,
      reasonCode: 'policy_not_ready',
      reason: 'session tool policy not installed yet',
    };
  }
  if (input.policy.enforcement === 'off') {
    return { allow: true, reasonCode: 'policy_off' };
  }
  const [broad, narrow] = capabilityGrantNames(
    input.capability,
    input.operation,
  );
  if (input.policy.allowedTools.has(broad)) {
    return { allow: true, reasonCode: 'capability_allowed' };
  }
  if (input.policy.allowedTools.has(narrow)) {
    return { allow: true, reasonCode: 'operation_allowed' };
  }
  return {
    allow: false,
    reasonCode: 'capability_not_permitted',
    reason: `host capability requires grant ${broad} or ${narrow}`,
  };
}
