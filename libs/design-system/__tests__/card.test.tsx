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

    expect(
      screen.getByRole('button', { name: 'Open diary' }),
    ).toBeInTheDocument();
  });

  it('meets the 44px minimum touch target when it is an action', () => {
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

    for (const element of [action, link]) {
      const minHeight = parseInt(getComputedStyle(element).minHeight, 10);
      expect(minHeight).toBeGreaterThanOrEqual(44);
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
