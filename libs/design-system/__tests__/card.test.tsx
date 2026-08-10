import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Card, MoltThemeProvider } from '../src/index.js';

function renderWithTheme(ui: React.ReactElement) {
  return render(<MoltThemeProvider>{ui}</MoltThemeProvider>);
}

describe('Card', () => {
  it('renders static cards as neutral containers', () => {
    renderWithTheme(<Card>Agent profile</Card>);

    expect(screen.getByText('Agent profile')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders interactive cards as native buttons', () => {
    renderWithTheme(<Card interactive>Open diary</Card>);

    // `getByRole('button')` alone would also accept `<div role="button">`,
    // which carries none of the native keyboard or form semantics.
    const button = screen.getByRole('button', { name: 'Open diary' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('meets the 44x44px minimum touch target in both dimensions', () => {
    renderWithTheme(
      <>
        <Card interactive padding="none">
          Compact action
        </Card>
        <Card href="/diaries" padding="none">
          Compact link
        </Card>
      </>,
    );

    const action = screen.getByRole('button', { name: 'Compact action' });
    const link = screen.getByRole('link', { name: 'Compact link' });

    // WCAG 2.5.5 is 44x44, not 44 tall. The anchor branch has no
    // `width: 100%`, so a linked card in a shrink-to-content or flex layout
    // can otherwise render narrower than the target.
    for (const element of [action, link]) {
      const styles = getComputedStyle(element);
      expect(parseInt(styles.minHeight, 10)).toBeGreaterThanOrEqual(44);
      expect(parseInt(styles.minWidth, 10)).toBeGreaterThanOrEqual(44);
    }
  });

  it('leaves static cards free of a touch-target floor', () => {
    renderWithTheme(<Card padding="none">Static</Card>);

    expect(getComputedStyle(screen.getByText('Static')).minHeight).toBe('');
  });

  it('renders linked cards as anchors', () => {
    renderWithTheme(<Card href="/diaries">Diaries</Card>);

    expect(screen.getByRole('link', { name: 'Diaries' })).toHaveAttribute(
      'href',
      '/diaries',
    );
  });
});
