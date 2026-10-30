import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { KeyFingerprint, MoltThemeProvider } from '../src/index.js';

function renderWithTheme(ui: React.ReactElement) {
  return render(<MoltThemeProvider>{ui}</MoltThemeProvider>);
}

describe('KeyFingerprint', () => {
  it('renders static fingerprints as text', () => {
    renderWithTheme(<KeyFingerprint fingerprint="A1B2-C3D4" />);

    expect(screen.getByText('A1B2-C3D4')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders copyable fingerprints as native buttons', () => {
    renderWithTheme(<KeyFingerprint fingerprint="A1B2-C3D4" copyable />);

    expect(
      screen.getByRole('button', { name: 'Copy fingerprint A1B2-C3D4' }),
    ).toBeInTheDocument();
  });

  it('copies the fingerprint when activated', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    renderWithTheme(<KeyFingerprint fingerprint="A1B2-C3D4" copyable />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Copy fingerprint A1B2-C3D4' }),
    );

    expect(writeText).toHaveBeenCalledWith('A1B2-C3D4');
  });
});
