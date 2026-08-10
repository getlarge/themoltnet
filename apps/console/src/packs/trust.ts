/**
 * Trust tiers for a rendered pack (#549).
 *
 * Derived, not stored: `renderedPacks.renderMethod` is a free-text
 * varchar(100) carrying only a convention, and the verified half comes from
 * `verifiedTaskId`. This module is the single place that convention is
 * parsed — see #1854 item 4 for why a real column would be better.
 *
 * `verifiedTaskId` records that a judgment task ran against the render. It
 * says nothing about the verdict: read the task to learn that.
 */
export type TrustTier =
  | 'server-rendered'
  | 'agent-refined'
  | 'agent-refined-verified'
  | 'unknown';

export interface TrustTierInput {
  renderMethod: string;
  verifiedTaskId: string | null;
}

/**
 * Prefixes that identify caller-authored markdown.
 *
 * `agent:` is the canonical label documented in docs/use/context-packs.md;
 * `pi:` is what libs/pi-runtime emits by default; `agent-` covers the
 * `agent-refined` / `agent-refined-v2` values that appear in older fixtures.
 * All three mean the same thing to the server, which bifurcates only on
 * `server:` (see ContextPackService.resolveRenderedMarkdown — a non-`server:`
 * method *requires* `renderedMarkdown` from the caller).
 */
const AGENT_AUTHORED_PREFIXES = ['agent:', 'agent-', 'pi:'] as const;

export function deriveTrustTier({
  renderMethod,
  verifiedTaskId,
}: TrustTierInput): TrustTier {
  if (renderMethod.startsWith('server:')) return 'server-rendered';
  if (
    AGENT_AUTHORED_PREFIXES.some((prefix) => renderMethod.startsWith(prefix))
  ) {
    return verifiedTaskId ? 'agent-refined-verified' : 'agent-refined';
  }
  // A method matching no known convention is not forced into a tier —
  // mislabelling a render silently is worse than admitting ignorance.
  return 'unknown';
}

export const TRUST_TIER_LABELS: Record<
  TrustTier,
  { label: string; description: string }
> = {
  'server-rendered': {
    label: 'Server rendered',
    description:
      'Produced deterministically by the server renderer. The same pack always renders the same bytes.',
  },
  'agent-refined': {
    label: 'Agent refined',
    description:
      'An agent authored this markdown from the source pack. No judgment task has run against it.',
  },
  'agent-refined-verified': {
    label: 'Agent refined · judged',
    description:
      'An agent authored this markdown and a judgment task has run against it. Open the task to read the verdict.',
  },
  unknown: {
    label: 'Unrecognised render method',
    description:
      'This render method matches neither the server nor the agent convention.',
  },
};
