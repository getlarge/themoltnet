import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), state: {} as unknown }));

vi.mock('../src/packs/hooks.js', () => ({
  usePinPack: () => ({
    mutate: mocks.mutate,
    ...(mocks.state as Record<string, unknown>),
  }),
}));

import { PinControl } from '../src/components/packs/PinControl.js';

const renderControl = (props: { packId: string; pinned: boolean }) =>
  render(
    <MoltThemeProvider>
      <PinControl {...props} />
    </MoltThemeProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = { isPending: false, isError: false, error: null };
});

describe('PinControl', () => {
  it('offers to pin an unpinned pack, naming the consequence', () => {
    renderControl({ packId: 'pack-1', pinned: false });

    expect(
      screen.getByRole('button', { name: /keep this pack past its expiry/i }),
    ).toBeInTheDocument();
  });

  it('offers to unpin a pinned pack, naming the consequence', () => {
    renderControl({ packId: 'pack-1', pinned: true });

    expect(
      screen.getByRole('button', { name: /let this pack expire/i }),
    ).toBeInTheDocument();
  });

  it('sends the inverted pin state and nothing else', () => {
    renderControl({ packId: 'pack-1', pinned: false });

    fireEvent.click(screen.getByRole('button'));

    // The hook owns the expiresAt invariant; a caller that assembled the body
    // itself could send the `{ pinned: false }` payload the API rejects.
    expect(mocks.mutate).toHaveBeenCalledWith({
      packId: 'pack-1',
      pinned: true,
    });
  });

  it('inverts the other way for a pinned pack', () => {
    renderControl({ packId: 'pack-2', pinned: true });

    fireEvent.click(screen.getByRole('button'));

    expect(mocks.mutate).toHaveBeenCalledWith({
      packId: 'pack-2',
      pinned: false,
    });
  });

  it('disables the control while the mutation is in flight', () => {
    mocks.state = { isPending: true, isError: false, error: null };
    renderControl({ packId: 'pack-1', pinned: false });

    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('does not fire a second mutation while pending', () => {
    mocks.state = { isPending: true, isError: false, error: null };
    renderControl({ packId: 'pack-1', pinned: false });

    fireEvent.click(screen.getByRole('button'));

    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('surfaces the API problem detail on failure', async () => {
    mocks.state = {
      isPending: false,
      isError: true,
      error: new Error('expiresAt is required when setting pinned to false'),
    };
    renderControl({ packId: 'pack-1', pinned: true });

    await waitFor(() =>
      expect(
        screen.getByText(/expiresAt is required when setting pinned to false/i),
      ).toBeInTheDocument(),
    );
  });

  it('falls back to a generic message when the error carries none', async () => {
    mocks.state = { isPending: false, isError: true, error: null };
    renderControl({ packId: 'pack-1', pinned: true });

    await waitFor(() =>
      expect(screen.getByText(/could not update/i)).toBeInTheDocument(),
    );
  });

  it('shows no error region when the mutation has not failed', () => {
    renderControl({ packId: 'pack-1', pinned: false });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
