import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  MoltThemeProvider,
  type SignatureState,
  SignatureStatus,
} from '../src/index.js';

function renderWithTheme(ui: React.ReactElement) {
  return render(<MoltThemeProvider>{ui}</MoltThemeProvider>);
}

describe('SignatureStatus', () => {
  it('exposes verification state to assistive tech via role + aria-label', () => {
    renderWithTheme(<SignatureStatus state="verified" />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-label', 'Signature status: Verified');
  });

  it('conveys state with a glyph, not color alone (WCAG 1.4.1)', () => {
    const glyphs: Record<SignatureState, string> = {
      verified: '✓',
      unverified: '?',
      invalid: '✕',
      pending: '⋯',
      unsigned: '—',
    };

    for (const [state, glyph] of Object.entries(glyphs)) {
      const { container, unmount } = renderWithTheme(
        <SignatureStatus state={state as SignatureState} />,
      );
      expect(container.textContent).toContain(glyph);
      unmount();
    }
  });

  it('distinguishes unsigned from unverified', () => {
    const { rerender } = renderWithTheme(<SignatureStatus state="unsigned" />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Signature status: Unsigned',
    );

    rerender(
      <MoltThemeProvider>
        <SignatureStatus state="unverified" />
      </MoltThemeProvider>,
    );
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Signature status: Unverified',
    );
  });

  it('renders an optional detail (e.g. a truncated signature)', () => {
    renderWithTheme(<SignatureStatus state="verified" detail="QFQF…MbBA" />);

    expect(screen.getByText('QFQF…MbBA')).toBeInTheDocument();
  });

  it('allows overriding the label', () => {
    renderWithTheme(
      <SignatureStatus state="verified" label="Signed by agent" />,
    );

    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Signature status: Signed by agent',
    );
  });
});
