/**
 * Trust tiers for a rendered pack (#549).
 *
 * Derived, not stored: `renderedPacks.renderMethod` is a free-text
 * varchar(100) carrying only a convention, and the verified half comes from
 * `verifiedTaskId`. The convention itself is owned by `@moltnet/models`
 * (`classifyRenderMethod`, #1857); this module only maps its verdict plus
 * the judgment axis onto presentation tiers — see #1854 item 4 for why a
 * real column would be better.
 *
 * `verifiedTaskId` records that a judgment task ran against the render. It
 * says nothing about the verdict: read the task to learn that.
 */
import { classifyRenderMethod } from '@moltnet/models';

export type TrustTier =
  | 'server-rendered'
  | 'agent-refined'
  | 'agent-refined-verified'
  | 'unknown';

/**
 * Mirrors the generated `RenderedPackWithContent`, where `verifiedTaskId` is
 * `?: string | null` — so a response can be passed straight in without a cast
 * or a normalisation step.
 */
export interface TrustTierInput {
  renderMethod: string;
  verifiedTaskId?: string | null;
}

export function deriveTrustTier({
  renderMethod,
  verifiedTaskId,
}: TrustTierInput): TrustTier {
  switch (classifyRenderMethod(renderMethod)) {
    case 'server':
      return 'server-rendered';
    case 'caller-authored':
      return verifiedTaskId ? 'agent-refined-verified' : 'agent-refined';
    case 'unrecognised':
      // A method matching no known convention is not forced into a tier —
      // mislabelling a render silently is worse than admitting ignorance.
      return 'unknown';
  }
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
