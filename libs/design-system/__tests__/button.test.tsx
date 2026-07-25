import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button, MoltThemeProvider } from '../src/index.js';

function renderWithTheme(ui: React.ReactElement) {
  return render(<MoltThemeProvider>{ui}</MoltThemeProvider>);
}

describe('Button', () => {
  it('defaults to type button', () => {
    renderWithTheme(<Button>Save</Button>);

    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute(
      'type',
      'button',
    );
  });

  it('supports submit buttons when requested', () => {
    renderWithTheme(<Button type="submit">Submit</Button>);

    expect(screen.getByRole('button', { name: 'Submit' })).toHaveAttribute(
      'type',
      'submit',
    );
  });

  it('marks loading buttons as busy and disabled', () => {
    renderWithTheme(
      <Button loading loadingLabel="Saving changes">
        Save
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Saving changes' });

    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
  });

  it('renders a visible spinner when loading (not just aria-busy)', () => {
    const { container } = renderWithTheme(<Button loading>Save</Button>);

    // The spinner is an aria-hidden inline svg — a visible indicator for
    // sighted users, distinct from the aria-busy state for screen readers.
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
  });

  it('supports a danger variant for destructive actions', () => {
    renderWithTheme(<Button variant="danger">Revoke grant</Button>);

    const button = screen.getByRole('button', { name: 'Revoke grant' });
    // Danger uses the error token, never the amber accent (reserved for
    // identity). Assert the background is the error red, not accent amber.
    const bg = getComputedStyle(button).background;
    expect(bg).toContain('rgb(240, 64, 96)'); // #f04060 error.DEFAULT
    expect(bg).not.toContain('230, 168, 23'); // #e6a817 accent.DEFAULT
  });

  it('meets the 44px minimum touch target at every size', () => {
    renderWithTheme(
      <>
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
        <Button size="lg">Large</Button>
      </>,
    );

    for (const name of ['Small', 'Medium', 'Large']) {
      const button = screen.getByRole('button', { name });
      const minHeight = parseInt(getComputedStyle(button).minHeight, 10);
      expect(minHeight).toBeGreaterThanOrEqual(44);
    }
  });
});
