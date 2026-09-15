import { fireEvent, render, screen } from '@testing-library/react';
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

  it('routes explicit confirm and cancel actions', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <MoltThemeProvider mode="dark">
        <ConfirmDialog
          open
          title="Remove bundle"
          message="The local bundle will be removed."
          confirmLabel="Remove bundle"
          destructive
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      </MoltThemeProvider>,
    );

    const confirm = screen.getByRole('button', {
      name: 'Remove bundle',
      hidden: true,
    });
    expect(confirm).toHaveStyle({ background: '#f04060' });
    fireEvent.click(confirm);
    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel', hidden: true }),
    );

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('does not render dialog content while closed', () => {
    render(
      <MoltThemeProvider mode="dark">
        <ConfirmDialog
          open={false}
          title="Confirm trust"
          message="macOS will update your login Keychain."
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />
      </MoltThemeProvider>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
