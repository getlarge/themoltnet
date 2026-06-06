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
});
