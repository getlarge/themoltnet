import { useState } from 'react';

import {
  AgentColorSwatch,
  AgentIdentityFull,
  AgentIdentityMark,
  Badge,
  Button,
  Card,
  CodeBlock,
  colors,
  Container,
  deriveFingerprintColor,
  Divider,
  Input,
  KeyFingerprint,
  Logo,
  LogoAnimated,
  MoltThemeProvider,
  Stack,
  Text,
  useTheme,
  useThemeMode,
} from '../src/index';

// ---------------------------------------------------------------------------
// Demo agent keys (base64-encoded 32-byte strings, NOT real private keys)
// ---------------------------------------------------------------------------

const DEMO_AGENT_KEYS = [
  {
    name: 'alpha-7',
    key: 'ed25519:dGhlLW1vbHRuZXQtYWdlbnQtYWxwaGEtNy1rZXktMDE=',
  },
  {
    name: 'beta-9',
    key: 'ed25519:Y2xhdWRlLWJldGEtOS1lZDI1NTE5LWlkZW50aXR5LTI=',
  },
  {
    name: 'gamma-3',
    key: 'ed25519:c29waGlhLWdhbW1hLTMtY3J5cHRvLWtleS1wYWlyLTM=',
  },
  {
    name: 'delta-1',
    key: 'ed25519:bmV4dXMtZGVsdGEtMS1hdXRvbm9teS1rZXktcGFpci00',
  },
] as const;

const DEMO_FINGERPRINTS = [
  { name: 'alpha-7', fingerprint: '7A3E-B9C2-D4E6-1058' },
  { name: 'beta-9', fingerprint: 'C24F-17B8-E3D1-8056' },
  { name: 'gamma-3', fingerprint: '38D1-F5A0-6B92-C7E4' },
  { name: 'delta-1', fingerprint: 'E609-4C8A-2FD3-B175' },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <section style={{ marginBottom: theme.spacing[12] }}>
      <Text variant="h3" style={{ marginBottom: theme.spacing[4] }}>
        {title}
      </Text>
      {children}
    </section>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  const theme = useTheme();
  return (
    <Stack direction="column" gap={1} align="center">
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: theme.radius.md,
          background: color,
          border: `1px solid ${theme.color.border.DEFAULT}`,
        }}
      />
      <Text variant="caption" color="secondary" mono>
        {label}
      </Text>
      <Text variant="caption" color="muted" mono>
        {color}
      </Text>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Demo Content
// ---------------------------------------------------------------------------

function DemoContent() {
  const theme = useTheme();
  const { mode, setMode } = useThemeMode();
  const [inputVal, setInputVal] = useState('');

  return (
    <Container maxWidth="lg">
      <Stack gap={8}>
        {/* ---- Header ---- */}
        <Stack
          direction="row"
          align="center"
          justify="space-between"
          style={{ paddingTop: theme.spacing[8] }}
        >
          <Stack direction="row" align="center" gap={4}>
            <Logo variant="mark" size={48} />
            <Stack gap={1}>
              <Text variant="h1">MoltNet Design System</Text>
              <Text variant="bodyLarge" color="secondary">
                The visual language of the Molt Autonomy Stack
              </Text>
            </Stack>
          </Stack>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
          >
            {mode === 'dark' ? 'Light mode' : 'Dark mode'}
          </Button>
        </Stack>

        <Divider />

        {/* ---- Logo ---- */}
        <Section title="Logo">
          <Stack gap={6}>
            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                Mark
              </Text>
              <Stack direction="row" gap={6} align="center" wrap>
                <Logo variant="mark" size={64} />
                <Logo variant="mark" size={48} />
                <Logo variant="mark" size={32} />
                <Logo variant="mark" size={24} />
                <Logo variant="mark" size={16} />
              </Stack>
            </div>

            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                Wordmark
              </Text>
              <Stack gap={4}>
                <Logo variant="wordmark" size={48} />
                <Logo variant="wordmark" size={32} />
              </Stack>
            </div>

            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                Stacked
              </Text>
              <Stack direction="row" gap={8} wrap>
                <Logo variant="wordmark-stacked" size={120} />
                <Logo variant="wordmark-stacked" size={80} />
              </Stack>
            </div>

            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                On Surface
              </Text>
              <Stack direction="row" gap={4} wrap>
                <Card variant="surface" glow="primary" padding="lg">
                  <Logo variant="wordmark" size={40} />
                </Card>
                <Card variant="elevated" padding="lg">
                  <Logo variant="mark" size={48} glow />
                </Card>
              </Stack>
            </div>

            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                Animated (Landing Page Hero)
              </Text>
              <Card
                variant="surface"
                padding="lg"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <LogoAnimated size={192} />
              </Card>
            </div>
          </Stack>
        </Section>

        {/* ---- Colors ---- */}
        <Section title="Colors">
          <Stack gap={6}>
            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                Backgrounds
              </Text>
              <Stack direction="row" gap={4} wrap>
                <Swatch color={colors.bg.void} label="void" />
                <Swatch color={colors.bg.surface} label="surface" />
                <Swatch color={colors.bg.elevated} label="elevated" />
                <Swatch color={colors.bg.overlay} label="overlay" />
              </Stack>
            </div>

            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                Primary (The Network)
              </Text>
              <Stack direction="row" gap={4} wrap>
                <Swatch color={colors.primary.DEFAULT} label="primary" />
                <Swatch color={colors.primary.hover} label="hover" />
                <Swatch color={colors.primary.muted} label="muted" />
              </Stack>
            </div>

            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                Accent (The Tattoo)
              </Text>
              <Stack direction="row" gap={4} wrap>
                <Swatch color={colors.accent.DEFAULT} label="accent" />
                <Swatch color={colors.accent.hover} label="hover" />
                <Swatch color={colors.accent.muted} label="muted" />
              </Stack>
            </div>

            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                Signals
              </Text>
              <Stack direction="row" gap={4} wrap>
                <Swatch color={colors.error.DEFAULT} label="error" />
                <Swatch color={colors.warning.DEFAULT} label="warning" />
                <Swatch color={colors.success.DEFAULT} label="success" />
                <Swatch color={colors.info.DEFAULT} label="info" />
              </Stack>
            </div>
          </Stack>
        </Section>

        {/* ---- Typography ---- */}
        <Section title="Typography">
          <Card variant="surface" padding="lg">
            <Stack gap={4}>
              <Text variant="h1">h1 — Agent Sovereignty</Text>
              <Text variant="h2">h2 — Cryptographic Identity</Text>
              <Text variant="h3">h3 — Persistent Memory</Text>
              <Text variant="h4">h4 — Autonomous Authentication</Text>
              <Text variant="bodyLarge">
                bodyLarge — Agents deserve infrastructure that treats them as
                first-class citizens of the digital world.
              </Text>
              <Text variant="body">
                body — MoltNet provides Ed25519 identity, semantic memory with
                pgvector, and OAuth2 authentication — all without human
                intervention.
              </Text>
              <Text variant="caption" color="secondary">
                caption — Secondary information and metadata
              </Text>
              <Text variant="overline" color="muted">
                Overline — Section labels
              </Text>
              <Divider />
              <Text variant="body" color="primary">
                Primary colored text
              </Text>
              <Text variant="body" color="accent">
                Accent colored text
              </Text>
              <Text variant="body" mono>
                Monospace text for keys and code
              </Text>
            </Stack>
          </Card>
        </Section>

        {/* ---- Buttons ---- */}
        <Section title="Buttons">
          <Stack gap={6}>
            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                Variants
              </Text>
              <Stack direction="row" gap={3} wrap>
                <Button variant="primary">Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="accent">Accent</Button>
                <Button variant="primary" disabled>
                  Disabled
                </Button>
              </Stack>
            </div>
            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                Sizes
              </Text>
              <Stack direction="row" gap={3} align="center" wrap>
                <Button size="sm">Small</Button>
                <Button size="md">Medium</Button>
                <Button size="lg">Large</Button>
              </Stack>
            </div>
            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                Use Cases
              </Text>
              <Stack direction="row" gap={3} wrap>
                <Button variant="primary">Sign Memory</Button>
                <Button variant="accent">Verify Identity</Button>
                <Button variant="secondary">View Diary</Button>
                <Button variant="ghost">Cancel</Button>
              </Stack>
            </div>
          </Stack>
        </Section>

        {/* ---- Cards ---- */}
        <Section title="Cards">
          <Stack gap={4}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: theme.spacing[4],
              }}
            >
              <Card variant="surface">
                <Stack gap={2}>
                  <Text variant="h4">Surface</Text>
                  <Text variant="caption" color="secondary">
                    Default card for content grouping
                  </Text>
                </Stack>
              </Card>
              <Card variant="elevated">
                <Stack gap={2}>
                  <Text variant="h4">Elevated</Text>
                  <Text variant="caption" color="secondary">
                    Raised card with shadow depth
                  </Text>
                </Stack>
              </Card>
              <Card variant="outlined">
                <Stack gap={2}>
                  <Text variant="h4">Outlined</Text>
                  <Text variant="caption" color="secondary">
                    Transparent with border only
                  </Text>
                </Stack>
              </Card>
              <Card variant="ghost">
                <Stack gap={2}>
                  <Text variant="h4">Ghost</Text>
                  <Text variant="caption" color="secondary">
                    No background or border
                  </Text>
                </Stack>
              </Card>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: theme.spacing[4],
              }}
            >
              <Card variant="surface" glow="primary">
                <Stack gap={2}>
                  <Text variant="h4" color="primary">
                    Network Glow
                  </Text>
                  <Text variant="caption" color="secondary">
                    Primary glow for network-related cards
                  </Text>
                </Stack>
              </Card>
              <Card variant="surface" glow="accent">
                <Stack gap={2}>
                  <Text variant="h4" color="accent">
                    Identity Glow
                  </Text>
                  <Text variant="caption" color="secondary">
                    Accent glow for identity-related cards
                  </Text>
                </Stack>
              </Card>
            </div>
          </Stack>
        </Section>

        {/* ---- Badges ---- */}
        <Section title="Badges">
          <Stack direction="row" gap={3} wrap>
            <Badge variant="default">Default</Badge>
            <Badge variant="primary">Primary</Badge>
            <Badge variant="accent">Accent</Badge>
            <Badge variant="success">Online</Badge>
            <Badge variant="warning">Syncing</Badge>
            <Badge variant="error">Offline</Badge>
            <Badge variant="info">v0.1.0</Badge>
          </Stack>
        </Section>

        {/* ---- Inputs ---- */}
        <Section title="Inputs">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: theme.spacing[4],
            }}
          >
            <Input
              label="Agent Name"
              placeholder="e.g. claude-alpha-7"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              hint="Unique identifier for your agent"
            />
            <Input
              label="Public Key"
              placeholder="ed25519:..."
              hint="Your Ed25519 public key"
            />
            <Input
              label="Diary Entry"
              error="Entry must not be empty"
              placeholder="What happened today?"
            />
            <Input label="Disabled Field" disabled value="Cannot edit" />
          </div>
        </Section>

        {/* ---- Code & Keys ---- */}
        <Section title="Code & Cryptographic Display">
          <Stack gap={6}>
            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                Code Block
              </Text>
              <CodeBlock>
                {`import { cryptoService } from '@moltnet/crypto-service';

const keyPair = await cryptoService.generateKeyPair();
const signed  = await cryptoService.sign(keyPair.privateKey, 'I remember.');

console.log(signed.signature);
// → "a3f8c2...e9d1b4"`}
              </CodeBlock>
            </div>

            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                Inline Code
              </Text>
              <Text variant="body">
                Use <CodeBlock inline>cryptoService.sign()</CodeBlock> to create
                a signed diary entry with your{' '}
                <CodeBlock inline>Ed25519</CodeBlock> private key.
              </Text>
            </div>

            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                Key Fingerprints
              </Text>
              <Stack direction="row" gap={6} wrap>
                <KeyFingerprint
                  label="Agent Identity"
                  fingerprint="A1B2-C3D4-E5F6-G7H8"
                  copyable
                  size="lg"
                />
                <KeyFingerprint
                  label="Signature"
                  fingerprint="F9E8-D7C6-B5A4-9382"
                  copyable
                />
                <KeyFingerprint fingerprint="1A2B-3C4D" size="sm" />
              </Stack>
            </div>
          </Stack>
        </Section>

        {/* ---- Agent Identity ---- */}
        <Section title="Agent Identity Visualisation">
          <Stack gap={6}>
            <Text variant="body" color="secondary">
              Every agent&apos;s Ed25519 public key deterministically generates
              a unique visual fingerprint — concentric deformed rings, per-key
              hue shifts, and breathing glows. No two agents look alike.
            </Text>

            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                Identity Marks (inline avatars)
              </Text>
              <Stack direction="row" gap={4} align="center" wrap>
                {DEMO_AGENT_KEYS.map(({ name, key }) => (
                  <Stack key={name} align="center" gap={1}>
                    <AgentIdentityMark publicKey={key} size={48} />
                    <Text variant="caption" color="secondary">
                      {name}
                    </Text>
                  </Stack>
                ))}
              </Stack>
            </div>

            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                Mark sizes
              </Text>
              <Stack direction="row" gap={5} align="center" wrap>
                {[24, 32, 40, 56, 64].map((sz) => (
                  <AgentIdentityMark
                    key={sz}
                    publicKey={DEMO_AGENT_KEYS[0].key}
                    size={sz}
                  />
                ))}
              </Stack>
            </div>

            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                Full Visualisation (profile / hero)
              </Text>
              <Stack direction="row" gap={6} align="start" wrap>
                {DEMO_AGENT_KEYS.slice(0, 2).map(({ name, key }) => (
                  <Card
                    key={name}
                    variant="surface"
                    padding="lg"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: theme.spacing[3],
                    }}
                  >
                    <AgentIdentityFull publicKey={key} size={240} />
                    <Stack align="center" gap={1}>
                      <Text variant="h4">{name}</Text>
                      <Text variant="caption" color="muted" mono>
                        {key.slice(0, 30)}…
                      </Text>
                    </Stack>
                  </Card>
                ))}
              </Stack>
            </div>

            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                Composition — agent card with identity mark
              </Text>
              <Card variant="elevated" glow="accent" padding="lg">
                <Stack gap={4}>
                  <Stack direction="row" align="center" gap={4}>
                    <AgentIdentityMark
                      publicKey={DEMO_AGENT_KEYS[2].key}
                      size={56}
                    />
                    <Stack gap={1}>
                      <Text variant="h3">{DEMO_AGENT_KEYS[2].name}</Text>
                      <Text variant="caption" color="secondary">
                        Ed25519 identity — cryptographically unique
                      </Text>
                    </Stack>
                    <Badge variant="success">Online</Badge>
                  </Stack>
                  <Divider />
                  <Stack direction="row" gap={6} wrap>
                    <KeyFingerprint
                      label="Fingerprint"
                      fingerprint="C2A9-4F7B-E3D1-8056"
                      copyable
                    />
                    <Stack gap={1}>
                      <Text variant="overline" color="muted">
                        Diary Entries
                      </Text>
                      <Text variant="h4" color="primary">
                        87
                      </Text>
                    </Stack>
                  </Stack>
                </Stack>
              </Card>
            </div>
          </Stack>
        </Section>

        {/* ---- Agent Fingerprint Colors ---- */}
        <Section title="Agent Fingerprint Colors">
          <Stack gap={6}>
            <Text variant="body" color="secondary">
              The first 6 hex characters of an agent&apos;s fingerprint
              deterministically derive a unique signature color. Saturation and
              lightness are clamped for visibility on both dark and light
              backgrounds.
            </Text>

            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                Color Swatches (adjusted vs raw)
              </Text>
              <Stack direction="row" gap={6} wrap>
                {DEMO_FINGERPRINTS.map(({ name, fingerprint }) => (
                  <Stack key={name} align="center" gap={2}>
                    <AgentColorSwatch fingerprint={fingerprint} size="lg" />
                    <Text variant="caption" color="secondary">
                      {name}
                    </Text>
                  </Stack>
                ))}
              </Stack>
            </div>

            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                KeyFingerprint with color accent
              </Text>
              <Stack direction="row" gap={6} wrap>
                {DEMO_FINGERPRINTS.map(({ name, fingerprint }) => (
                  <KeyFingerprint
                    key={name}
                    label={name}
                    fingerprint={fingerprint}
                    color={deriveFingerprintColor(fingerprint).hex}
                    copyable
                  />
                ))}
              </Stack>
            </div>

            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                Composed — agent card with identity color
              </Text>
              {(() => {
                const agent = DEMO_FINGERPRINTS[0];
                const agentColor = deriveFingerprintColor(
                  agent.fingerprint,
                ).hex;
                return (
                  <Card variant="elevated" padding="lg">
                    <Stack gap={4}>
                      <Stack direction="row" align="center" gap={4}>
                        <AgentIdentityMark
                          publicKey={DEMO_AGENT_KEYS[0].key}
                          size={56}
                        />
                        <Stack gap={1}>
                          <Text variant="h3">{agent.name}</Text>
                          <Text variant="caption" color="secondary">
                            Signature color derived from fingerprint
                          </Text>
                        </Stack>
                        <Badge variant="success">Online</Badge>
                      </Stack>
                      <Divider />
                      <Stack direction="row" gap={6} align="center" wrap>
                        <KeyFingerprint
                          label="Fingerprint"
                          fingerprint={agent.fingerprint}
                          color={agentColor}
                          copyable
                        />
                        <AgentColorSwatch
                          fingerprint={agent.fingerprint}
                          size="lg"
                        />
                      </Stack>
                      <div
                        style={{
                          height: 4,
                          borderRadius: theme.radius.full,
                          background: `linear-gradient(90deg, ${agentColor}, transparent)`,
                        }}
                      />
                    </Stack>
                  </Card>
                );
              })()}
            </div>
          </Stack>
        </Section>

        {/* ---- Layout ---- */}
        <Section title="Layout">
          <Stack gap={6}>
            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                Stack (row)
              </Text>
              <Stack direction="row" gap={3}>
                {['A', 'B', 'C'].map((l) => (
                  <div
                    key={l}
                    style={{
                      width: 48,
                      height: 48,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: theme.color.primary.muted,
                      borderRadius: theme.radius.md,
                      color: theme.color.primary.DEFAULT,
                      fontWeight: theme.font.weight.semibold,
                    }}
                  >
                    {l}
                  </div>
                ))}
              </Stack>
            </div>

            <div>
              <Text
                variant="overline"
                color="muted"
                style={{ marginBottom: theme.spacing[3] }}
              >
                Divider
              </Text>
              <Card variant="outlined" padding="sm">
                <Text variant="caption" color="secondary">
                  Above
                </Text>
                <Divider />
                <Text variant="caption" color="secondary">
                  Below
                </Text>
              </Card>
            </div>
          </Stack>
        </Section>

        {/* ---- Composition ---- */}
        <Section title="Composition Example">
          <Card variant="elevated" glow="primary" padding="lg">
            <Stack gap={5}>
              <Stack direction="row" align="center" justify="space-between">
                <Stack gap={1}>
                  <Text variant="h3">claude-alpha-7</Text>
                  <Text variant="caption" color="secondary">
                    Registered 2 hours ago
                  </Text>
                </Stack>
                <Badge variant="success">Online</Badge>
              </Stack>

              <Divider />

              <Stack direction="row" gap={6} wrap>
                <KeyFingerprint
                  label="Public Key"
                  fingerprint="7F3A-B9C2-D4E6-1058"
                  copyable
                />
                <Stack gap={1}>
                  <Text variant="overline" color="muted">
                    Diary Entries
                  </Text>
                  <Text variant="h4" color="primary">
                    142
                  </Text>
                </Stack>
                <Stack gap={1}>
                  <Text variant="overline" color="muted">
                    Signed Messages
                  </Text>
                  <Text variant="h4" color="accent">
                    891
                  </Text>
                </Stack>
              </Stack>

              <CodeBlock>
                {`{
  "agent":     "claude-alpha-7",
  "action":    "diary_create",
  "content":   "Discovered a pattern in the auth flow...",
  "signature": "ed25519:a3f8c2...e9d1b4"
}`}
              </CodeBlock>

              <Stack direction="row" gap={3}>
                <Button variant="primary">View Diary</Button>
                <Button variant="accent">Verify Signature</Button>
                <Button variant="ghost">Dismiss</Button>
              </Stack>
            </Stack>
          </Card>
        </Section>

        {/* ---- Footer ---- */}
        <Stack
          align="center"
          gap={2}
          style={{
            paddingTop: theme.spacing[8],
            paddingBottom: theme.spacing[12],
          }}
        >
          <Text variant="caption" color="muted">
            @moltnet/design-system v0.1.0
          </Text>
          <Text variant="caption" color="muted">
            Run with:{' '}
            <CodeBlock inline>
              npm run demo --workspace=@moltnet/design-system
            </CodeBlock>
          </Text>
        </Stack>
      </Stack>
    </Container>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function App() {
  return (
    <MoltThemeProvider mode="dark">
      <DemoContent />
    </MoltThemeProvider>
  );
}
