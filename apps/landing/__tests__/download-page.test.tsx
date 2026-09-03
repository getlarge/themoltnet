import { render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { detectPlatform, DownloadPage } from '../src/pages/DownloadPage';

function renderPage() {
  const { hook } = memoryLocation({ path: '/download' });
  return render(
    <MoltThemeProvider mode="dark">
      <Router hook={hook}>
        <DownloadPage />
      </Router>
    </MoltThemeProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detectPlatform', () => {
  it('defaults macOS to Apple Silicon (arch is not detectable)', () => {
    expect(
      detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'),
    ).toBe('darwin-arm64');
  });

  it('maps Windows to windows-x64', () => {
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(
      'windows-x64',
    );
  });

  it('maps Linux arm64 and falls back to linux-x64', () => {
    expect(detectPlatform('Mozilla/5.0 (X11; Linux aarch64)')).toBe(
      'linux-arm64',
    );
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux-x64');
  });
});

describe('DownloadPage', () => {
  it('shows pinned versions from the manifest on every link group', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            cli: { version: '1.87.1', tag: 'cli-v1.87.1' },
            agent: { version: '0.47.0', tag: 'agent-daemon-v0.47.0' },
            signer: {
              principal: 'legreffier@themolt.net',
              namespace: 'moltnet-release',
              publicKey: 'ssh-ed25519 AAAAC3TESTKEY',
            },
          }),
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /MoltNet CLI v1\.87\.1/ }),
      ).toBeTruthy();
    });
    expect(
      screen.getByRole('heading', { name: /MoltNet Agent v0\.47\.0/ }),
    ).toBeTruthy();
    // The publisher key is runtime-served through the manifest, never baked
    // into the bundle.
    expect(
      screen.getAllByText(/ssh-ed25519 AAAAC3TESTKEY/).length,
    ).toBeGreaterThanOrEqual(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/download/manifest.json');
  });

  it('renders every platform link with an accessible product+platform name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    renderPage();

    // Version-less names when the manifest is unavailable.
    await waitFor(() => {
      expect(
        screen.getByRole('link', {
          name: 'Download MoltNet CLI for Linux (arm64) (tar.gz)',
        }),
      ).toBeTruthy();
    });
    for (const name of [
      'Download MoltNet CLI for macOS (Apple Silicon) (tar.gz)',
      'Download MoltNet CLI for macOS (Intel) (tar.gz)',
      'Download MoltNet CLI for Windows (x64) (zip)',
      'Download MoltNet CLI for Windows (arm64) (zip)',
      'Download MoltNet CLI checksums file',
      'Download MoltNet Agent bundle for macOS (Apple Silicon) (tar.gz)',
      'Download MoltNet Agent bundle for Linux (x64) (tar.gz)',
      'Download MoltNet Agent checksum signature for Linux (x64)',
    ]) {
      expect(screen.getByRole('link', { name })).toBeTruthy();
    }
    expect(
      screen
        .getByRole('link', {
          name: 'Download MoltNet CLI for Windows (x64) (zip)',
        })
        .getAttribute('href'),
    ).toBe('/download/cli/windows-x64');
  });

  it('offers the Intel alternative next to the Apple Silicon primary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    });

    renderPage();

    expect(
      screen.getByRole('link', {
        name: 'Download MoltNet CLI for macOS (Apple Silicon)',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', {
        name: 'Download MoltNet CLI for macOS (Intel)',
      }),
    ).toBeTruthy();
  });

  it('documents verification with the publisher key and trust levels', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    renderPage();

    // Without the manifest the key is unavailable: the page must not
    // invent one, and the commands show a placeholder instead.
    expect(screen.queryByText(/ssh-ed25519 AAAAC3/)).toBeNull();
    expect(
      screen.getAllByText(/publisher key — see \/download\/manifest\.json/)
        .length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(/moltnet-release/).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/SmartScreen/)).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Verify your download' }),
    ).toBeTruthy();
  });

  it('spells out CLI checksum verification for the detected platform', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (X11; Linux aarch64)',
    });

    renderPage();

    expect(
      screen.getByText(
        /curl -fsSLOJ https:\/\/themolt\.net\/download\/cli\/linux-arm64/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /curl -fsSLOJ https:\/\/themolt\.net\/download\/cli\/checksums\.sig/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(/shasum -a 256 -c checksums\.txt --ignore-missing/),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Copy the CLI verification commands',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Copy the agent bundle verification commands',
      }),
    ).toBeTruthy();
  });

  it('focuses the verification section when reached by hash', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    window.history.replaceState({}, '', '/download#verify');
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    renderPage();

    const verify = document.getElementById('verify');
    await waitFor(() => expect(verify).toHaveFocus());
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'start',
      behavior: 'instant',
    });
    window.history.replaceState({}, '', '/');
  });
});
