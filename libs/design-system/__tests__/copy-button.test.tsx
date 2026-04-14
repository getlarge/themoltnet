import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopyButton, MoltThemeProvider } from '../src/index.js';

function renderWithTheme(ui: React.ReactElement) {
  return render(<MoltThemeProvider>{ui}</MoltThemeProvider>);
}

describe('CopyButton', () => {
  afterEach(cleanup);

  it('renders the text value', () => {
    renderWithTheme(<CopyButton value="mlt_inv_abc123" />);
    expect(screen.getByText('mlt_inv_abc123')).toBeDefined();
  });

  it('copies value to clipboard on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    renderWithTheme(<CopyButton value="mlt_inv_abc123" />);
    fireEvent.click(screen.getByRole('button'));
    expect(writeText).toHaveBeenCalledWith('mlt_inv_abc123');
  });

  it('renders with custom label', () => {
    renderWithTheme(<CopyButton value="abc" label="Code" />);
    expect(screen.getByText('Code')).toBeDefined();
  });
});
