import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';

import {
  AgentIdentityFull,
  AgentIdentityMark,
  Badge,
  Button,
  Card,
  CodeBlock,
  CopyButton,
  Dialog,
  Divider,
  Input,
  KeyFingerprint,
  Logo,
  LogoAnimated,
  MoltThemeProvider,
  Stack,
  Text,
  Tooltip,
} from '../src/index.js';

const PUBLIC_KEY = 'ed25519:fQuJevoiEGBD/U1ZxizBqVmWI5leTjHInhFLJCSipSs=';
const checkA11y = configureAxe({
  rules: {
    // axe's color-contrast rule requires canvas APIs that jsdom does not
    // implement. Contrast remains a documented design-system requirement and
    // should be verified in browser-level visual/a11y checks.
    'color-contrast': { enabled: false },
  },
});

function renderWithTheme(ui: React.ReactElement) {
  return render(<MoltThemeProvider>{ui}</MoltThemeProvider>);
}

function mockReducedMotion(prefersReduce: boolean) {
  // Answer every query with a valid MediaQueryList so unrelated consumers
  // (e.g. theme-provider's prefers-color-scheme check) don't read `.matches`
  // off undefined; only the reduced-motion query reflects `prefersReduce`.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? prefersReduce : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

describe('LogoAnimated reduced-motion fallback', () => {
  afterEach(() => {
    // Restore the jsdom default (matchMedia undefined) so the smoke tests,
    // which rely on that guard path, are not affected by the mock above.
    delete (window as { matchMedia?: unknown }).matchMedia;
    vi.restoreAllMocks();
  });

  it('drops SMIL animation when prefers-reduced-motion is set', () => {
    // SVG <animate> (SMIL) cannot be disabled by CSS, so LogoAnimated must
    // fall back to the static Logo when the user prefers reduced motion.
    mockReducedMotion(true);
    const { container } = renderWithTheme(<LogoAnimated />);
    expect(container.querySelectorAll('animate')).toHaveLength(0);
  });

  it('keeps SMIL animation when motion is allowed', () => {
    mockReducedMotion(false);
    const { container } = renderWithTheme(<LogoAnimated />);
    expect(container.querySelectorAll('animate').length).toBeGreaterThan(0);
  });
});

describe('design-system accessibility smoke tests', () => {
  it('renders core controls without axe violations', async () => {
    const { container } = renderWithTheme(
      <Stack gap={4}>
        <Button>Save</Button>
        <Button loading loadingLabel="Saving changes">
          Save
        </Button>
        <Card interactive>Open diary</Card>
        <Card href="/diaries">Diaries</Card>
        <Input label="Agent name" hint="This name is visible to teammates" />
        <Input label="Invite code" error="Invite code is required" />
        <CopyButton value="mlt_inv_abc123" label="Invite code" />
        <KeyFingerprint fingerprint="A1B2-C3D4" copyable />
        <Tooltip content="Shows the current agent">
          <Button>Agent details</Button>
        </Tooltip>
      </Stack>,
    );

    const results = await checkA11y(container);

    expect(results.violations).toHaveLength(0);
  });

  it('renders display components without axe violations', async () => {
    const { container } = renderWithTheme(
      <Stack gap={4}>
        <Text variant="h2">Identity</Text>
        <Text>Persistent agent identity details.</Text>
        <Badge variant="success">Verified</Badge>
        <Divider />
        <CodeBlock language="typescript">const signed = true;</CodeBlock>
        <Logo />
        <LogoAnimated />
        <AgentIdentityMark publicKey={PUBLIC_KEY} />
        <AgentIdentityFull publicKey={PUBLIC_KEY} animated={false} />
      </Stack>,
    );

    const results = await checkA11y(container);

    expect(results.violations).toHaveLength(0);
  });

  it('renders named dialogs without axe violations', async () => {
    const { container } = renderWithTheme(
      <Dialog open onClose={() => {}} title="Create team">
        <Input label="Team name" />
      </Dialog>,
    );

    const results = await checkA11y(container);

    expect(results.violations).toHaveLength(0);
  });
});
