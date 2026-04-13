import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Dialog, MoltThemeProvider } from '../src/index.js';

// jsdom does not implement HTMLDialogElement.showModal/close, which leaves
// <dialog> elements in a closed (inert) state, making their contents
// inaccessible to role-based queries. Stub both methods so the dialog is
// treated as open when showModal() has been called.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

function renderWithTheme(ui: React.ReactElement) {
  return render(<MoltThemeProvider>{ui}</MoltThemeProvider>);
}

describe('Dialog', () => {
  afterEach(cleanup);

  it('renders children when open', () => {
    renderWithTheme(
      <Dialog open onClose={() => {}}>
        <p>Dialog content</p>
      </Dialog>,
    );
    expect(screen.getByText('Dialog content')).toBeDefined();
  });

  it('does not render children when closed', () => {
    renderWithTheme(
      <Dialog open={false} onClose={() => {}}>
        <p>Dialog content</p>
      </Dialog>,
    );
    expect(screen.queryByText('Dialog content')).toBeNull();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    renderWithTheme(
      <Dialog open onClose={onClose} title="Test">
        <p>Content</p>
      </Dialog>,
    );
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders title when provided', () => {
    renderWithTheme(
      <Dialog open onClose={() => {}} title="My Dialog">
        <p>Content</p>
      </Dialog>,
    );
    expect(screen.getByText('My Dialog')).toBeDefined();
  });
});
