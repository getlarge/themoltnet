import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from '../components/confirm-dialog.js';
import { MoltThemeProvider } from '../theme-provider.js';

describe('ConfirmDialog', () => {
  it('associates its confirmation message with the dialog', () => {
    render(
      <MoltThemeProvider mode="dark">
        <ConfirmDialog
          open
          title="Confirm trust"
          message="macOS will update your login Keychain."
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />
      </MoltThemeProvider>,
    );

    expect(
      screen.getByRole('dialog', { hidden: true }),
    ).toHaveAccessibleDescription('macOS will update your login Keychain.');
  });
});
