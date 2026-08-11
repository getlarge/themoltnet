import { Badge, type BadgeVariant } from '@themoltnet/design-system';

import type { DecayState } from '../../packs/decay.js';

export interface DecayBadgeProps {
  state: DecayState;
}

/**
 * Pack lifecycle state as a labelled badge.
 *
 * Constraint 6 (WCAG 1.4.1): the state is carried by the text, and colour only
 * reinforces it. `Badge` is the house primitive for exactly this pairing — see
 * `RoleBadge`, `AgentKeysPage`, `OverviewPage` — so this does not hand-roll a
 * dot-plus-label equivalent (Constraint 7).
 *
 * `pinned` uses `accent` (Identity Amber): keeping a pack past its expiry is a
 * human retention decision, which is an attestation. The other kinds are
 * ordinary lifecycle signals and use the signal tokens.
 */
function describe(state: DecayState): { variant: BadgeVariant; label: string } {
  switch (state.kind) {
    case 'pinned':
      return { variant: 'accent', label: 'Pinned' };
    case 'expiring':
      return {
        variant: 'warning',
        label: `Expires in ${state.daysRemaining} ${
          state.daysRemaining === 1 ? 'day' : 'days'
        }`,
      };
    case 'expired':
      return { variant: 'error', label: 'Expired' };
    case 'no-expiry':
      return { variant: 'default', label: 'No expiry' };
  }
}

export function DecayBadge({ state }: DecayBadgeProps) {
  const { variant, label } = describe(state);
  return <Badge variant={variant}>{label}</Badge>;
}
