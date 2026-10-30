import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ActionLink, MoltThemeProvider } from '../src/index.js';

function renderWithTheme(ui: React.ReactElement) {
  return render(<MoltThemeProvider>{ui}</MoltThemeProvider>);
}

describe('ActionLink', () => {
  it('renders one native link without nested controls', () => {
    renderWithTheme(<ActionLink href="/tasks">View tasks</ActionLink>);

    const link = screen.getByRole('link', { name: 'View tasks' });
    expect(link).toHaveAttribute('href', '/tasks');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('meets the 44px minimum touch target at every size', () => {
    renderWithTheme(
      <>
        <ActionLink href="/small" size="sm">
          Small
        </ActionLink>
        <ActionLink href="/medium" size="md">
          Medium
        </ActionLink>
        <ActionLink href="/large" size="lg">
          Large
        </ActionLink>
      </>,
    );

    for (const name of ['Small', 'Medium', 'Large']) {
      const link = screen.getByRole('link', { name });
      expect(
        parseInt(getComputedStyle(link).minHeight, 10),
      ).toBeGreaterThanOrEqual(44);
    }
  });
});
