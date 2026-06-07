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

  it('renders linked cards as anchors', () => {
    renderWithTheme(<Card href="/diaries">Diaries</Card>);

    expect(screen.getByRole('link', { name: 'Diaries' })).toHaveAttribute(
      'href',
      '/diaries',
    );
  });
});
