import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { Dialog, MoltThemeProvider } from '../src/index.js';

// jsdom does not implement HTMLDialogElement.showModal/close, which leaves
// <dialog> elements in a closed (inert) state, making their contents
// inaccessible to role-based queries. Stub both methods so the dialog is
// treated as open when showModal() has been called. Restore originals after
// the suite so other test files see real jsdom behavior.
const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;

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

afterAll(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
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
    expect(screen.getByRole('dialog', { name: 'My Dialog' })).toBeDefined();
  });

  it('uses ariaLabel when no visible title is provided', () => {
    renderWithTheme(
      <Dialog open onClose={() => {}} ariaLabel="Background task progress">
        <p>Content</p>
      </Dialog>,
    );

    expect(
      screen.getByRole('dialog', { name: 'Background task progress' }),
    ).toBeDefined();
  });

  it('supports an external description', () => {
    renderWithTheme(
      <>
        <p id="dialog-description">This action cannot be undone.</p>
        <Dialog
          open
          onClose={() => {}}
          title="Delete team"
          ariaDescribedBy="dialog-description"
        >
          <p>Content</p>
        </Dialog>
      </>,
    );

    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      'This action cannot be undone.',
    );
  });

  it('restores focus when closed through the controlled open prop', () => {
    const { rerender } = renderWithTheme(
      <>
        <button type="button">Open dialog</button>
        <Dialog open={false} onClose={() => {}} title="Settings">
          <button type="button">Save</button>
        </Dialog>
      </>,
    );

    const opener = screen.getByRole('button', { name: 'Open dialog' });
    opener.focus();

    rerender(
      <MoltThemeProvider>
        <>
          <button type="button">Open dialog</button>
          <Dialog open onClose={() => {}} title="Settings">
            <button type="button">Save</button>
          </Dialog>
        </>
      </MoltThemeProvider>,
    );

    rerender(
      <MoltThemeProvider>
        <>
          <button type="button">Open dialog</button>
          <Dialog open={false} onClose={() => {}} title="Settings">
            <button type="button">Save</button>
          </Dialog>
        </>
      </MoltThemeProvider>,
    );

    expect(opener).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
