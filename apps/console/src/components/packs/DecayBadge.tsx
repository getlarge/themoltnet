import { Badge, type BadgeVariant } from '@themoltnet/design-system';

import { type DecayState, isExpiringSoon } from '../../packs/decay.js';

export interface DecayBadgeProps {
  state: DecayState;
}

/**
 * Pack lifecycle state as a labelled badge.
 *
 * Constraint 6 (WCAG 1.4.1): the state is carried by the text, and colour only
 * reinforces it. `Badge` is the house primitive for that pairing — see
 * `RoleBadge`, `AgentKeysPage`, `OverviewPage` — so this does not hand-roll a
 * dot-plus-label equivalent (Constraint 7).
 *
 * Lifecycle lives entirely in the signal tokens. Identity Amber is reserved for
 * "who or what attests" (DESIGN.md, the two-layer rule): keys, signatures,
 * fingerprints. Pinning is a retention setting, not an attestation — and a
 * pinned pack sits in the same row as its creator fingerprint, so spending
 * amber here would put amber twice in one row meaning two different things.
 *
 * `warning` is reserved for packs inside the decay window, so the badge answers
 * "is this about to go?" rather than colouring every future expiry alike.
 */
function describe(state: DecayState): { variant: BadgeVariant; label: string } {
  switch (state.kind) {
    case 'pinned':
      return { variant: 'success', label: 'Pinned' };
    case 'expiring':
      return {
        variant: isExpiringSoon(state) ? 'warning' : 'default',
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
