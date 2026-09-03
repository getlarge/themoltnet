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

  it('announces successful copy state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    renderWithTheme(<CopyButton value="mlt_inv_abc123" />);
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));

    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('renders with custom label', () => {
    renderWithTheme(<CopyButton value="abc" label="Code" />);
    expect(screen.getByRole('button', { name: 'Copy Code' })).toBeDefined();
  });

  it('shows short chip text instead of a multi-line value while copying the value', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const script =
      '# step one\ncurl -fsSLO https://example.test/a\nshasum -c a';

    renderWithTheme(
      <CopyButton value={script} text="Copy" ariaLabel="Copy the script" />,
    );

    const button = screen.getByRole('button', { name: 'Copy the script' });
    expect(button.textContent).toContain('Copy');
    expect(button.textContent).not.toContain('curl');
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith(script);
  });
});
