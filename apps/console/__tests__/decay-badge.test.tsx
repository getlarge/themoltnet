import { render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it } from 'vitest';

import { DecayBadge } from '../src/components/packs/DecayBadge.js';

const renderBadge = (state: Parameters<typeof DecayBadge>[0]['state']) =>
  render(
    <MoltThemeProvider>
      <DecayBadge state={state} />
    </MoltThemeProvider>,
  );

describe('DecayBadge', () => {
  it('labels a pinned pack in text, not only colour', () => {
    renderBadge({ kind: 'pinned' });
    expect(screen.getByText(/pinned/i)).toBeInTheDocument();
  });

  it('states the number of days remaining', () => {
    renderBadge({ kind: 'expiring', daysRemaining: 4 });
    expect(screen.getByText(/expires in 4 days/i)).toBeInTheDocument();
  });

  it('uses the singular for one day', () => {
    renderBadge({ kind: 'expiring', daysRemaining: 1 });
    expect(screen.getByText(/expires in 1 day$/i)).toBeInTheDocument();
  });

  it('marks an expired pack', () => {
    renderBadge({ kind: 'expired' });
    expect(screen.getByText(/expired/i)).toBeInTheDocument();
  });

  it('renders nothing loud when there is no expiry', () => {
    renderBadge({ kind: 'no-expiry' });
    expect(screen.getByText(/no expiry/i)).toBeInTheDocument();
  });

  // Constraint 6: state is never carried by colour alone. Every kind must put
  // its state into text a screen reader reaches without styling.
  it.each([
    [{ kind: 'pinned' } as const, /pinned/i],
    [{ kind: 'expiring', daysRemaining: 3 } as const, /expires in 3 days/i],
    [{ kind: 'expired' } as const, /expired/i],
    [{ kind: 'no-expiry' } as const, /no expiry/i],
  ])('exposes %o as text content', (state, pattern) => {
    const { container } = renderBadge(state);
    expect(container.textContent ?? '').toMatch(pattern);
  });

  // Retention is a human attestation, so pinned is the one Identity Amber
  // case here; the rest are ordinary lifecycle signals.
  it('renders pinned distinctly from expiring', () => {
    const { container: pinned } = renderBadge({ kind: 'pinned' });
    const { container: expiring } = renderBadge({
      kind: 'expiring',
      daysRemaining: 3,
    });
    expect(pinned.innerHTML).not.toBe(expiring.innerHTML);
  });
});
