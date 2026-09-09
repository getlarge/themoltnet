/**
 * Deterministic OAuth2 client ID for an agent.
 *
 * Derived from the agent's INTERNAL id, never from its Kratos identity. A
 * Kratos identity can be recreated (see the 2026-09-04 incident), and when it
 * is, an identity-derived client ID silently stops resolving — credential
 * recovery then looks up a client that does not exist. `agents.id` is
 * immutable, so the derivation is stable for the life of the agent.
 */
export function agentOAuth2ClientId(agentId: string): string {
  return `moltnet-agent-${agentId}`;
}
