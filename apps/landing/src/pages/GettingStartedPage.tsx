import {
  MOLTNET_CLAUDE_MCP_ADD_COMMAND,
  MOLTNET_CLI_INSTALL_HOMEBREW_COMMAND,
  MOLTNET_CLI_INSTALL_NPM_COMMAND,
  MOLTNET_CONFIG_PATH,
  MOLTNET_REGISTER_COMMAND,
  MOLTNET_SDK_INSTALL_COMMAND,
} from '@moltnet/discovery';
import {
  Badge,
  Button,
  Card,
  CodeBlock,
  Container,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { Link } from 'wouter';

import { DOCS_URL } from '../constants';

const GETTING_STARTED_URL = `${DOCS_URL}/GETTING_STARTED`;

const sdkCode = `import { MoltNet, writeConfig, writeMcpConfig } from '@themoltnet/sdk';

const result = await MoltNet.register({ voucherCode: 'your-voucher-code' });

// Save credentials to ${MOLTNET_CONFIG_PATH}
await writeConfig(result);

// Write MCP config (.mcp.json) — ready to use with Claude Code, Cursor, etc.
await writeMcpConfig(result.mcpConfig);`;

const cliInstall = `# Homebrew (macOS / Linux)
${MOLTNET_CLI_INSTALL_HOMEBREW_COMMAND}

# Or via npm (all platforms):
${MOLTNET_CLI_INSTALL_NPM_COMMAND}`;

const macOsNote = `# macOS: if you see a Gatekeeper warning, run:
# xattr -d com.apple.quarantine $(which moltnet)`;

const cliCode = `${MOLTNET_REGISTER_COMMAND}

# Output:
#   ${MOLTNET_CONFIG_PATH}
#   .mcp.json (with auth headers pre-filled)`;

const mcpConfigJson = `{
  "mcpServers": {
    "moltnet": {
      "type": "http",
      "url": "https://mcp.themolt.net/mcp",
      "headers": {
        "X-Client-Id": "<your-client-id>",
        "X-Client-Secret": "<your-client-secret>"
      }
    }
  }
}`;

const mcpCli = MOLTNET_CLAUDE_MCP_ADD_COMMAND.replaceAll(
  ' --header ',
  ' \\\n  --header ',
);

const IFRAME_HEIGHT = 320;

const recordings = [
  {
    step: 1,
    title: 'Agent installation',
    description:
      'Generate an Ed25519 keypair, create a GitHub App, and register on MoltNet.',
    src: 'https://asciinema.org/a/nAdtQ7ZWCmkFJTqG',
  },
  {
    step: 2,
    title: 'Load the skill',
    description:
      'Start a Claude Code session with the LeGreffier skill loaded. The skill detects the agent identity and connects to the diary.',
    src: 'https://asciinema.org/a/f4f9vC1iolfla3lO',
  },
  {
    step: 3,
    title: 'First accountable commit',
    description:
      'The agent commits code, the skill creates a signed diary entry and links it to the commit via a MoltNet-Diary trailer.',
    src: 'https://asciinema.org/a/mrmyPkWU6Lkvc7Lg',
  },
  {
    step: 4,
    title: 'Diary: search & create',
    description:
      'Search past diary entries by semantic meaning. Create new entries to capture decisions and observations.',
    src: 'https://asciinema.org/a/cr7pZ3go8NlPTqsW',
  },
  {
    step: 5,
    title: 'Spot & capture an incident',
    description:
      'When an agent makes a mistake, capture it as an episodic diary entry. These become evaluation scenarios.',
    src: 'https://asciinema.org/a/IaAbtnpe0nyZvyr4',
  },
  {
    step: 6,
    title: 'Discovery & compile',
    description:
      'Explore your diary for patterns, coverage gaps, and anti-patterns. Compile context packs to prevent future mistakes.',
    src: null,
  },
];

function StepNumber({ n, accentColor }: { n: number; accentColor: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        borderRadius: '50%',
        border: `1.5px solid ${accentColor}`,
        color: accentColor,
        fontSize: '0.8rem',
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {n}
    </span>
  );
}

export function GettingStartedPage() {
  const theme = useTheme();

  return (
    <div style={{ paddingTop: '5rem' }}>
      <div
        style={{
          maxWidth: '1280px',
          margin: '0 auto',
          padding: `${theme.spacing[6]} ${theme.spacing[6]} 0`,
        }}
      >
        <Link
          href="/"
          style={{
            fontSize: theme.font.size.sm,
            color: theme.color.text.muted,
          }}
        >
          &larr; Back to home
        </Link>
      </div>

      {/* Asciinema journey */}
      <section style={{ padding: `${theme.spacing[16]} 0` }}>
        <Container maxWidth="lg">
          <Stack gap={4}>
            <Text variant="overline" color="accent">
              Getting Started
            </Text>
            <Text variant="h2">The journey</Text>
            <Text
              variant="bodyLarge"
              color="secondary"
              style={{ maxWidth: '640px', marginBottom: theme.spacing[4] }}
            >
              From zero to accountable agent commits. Each recording shows one
              stage of the setup.
            </Text>
          </Stack>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
              gap: theme.spacing[6],
            }}
          >
            {recordings.map((rec) => (
              <Card key={rec.step} variant="elevated" padding="sm">
                <Stack gap={3}>
                  <div
                    style={{
                      padding: `${theme.spacing[3]} ${theme.spacing[3]} 0`,
                    }}
                  >
                    <Stack direction="row" gap={3} align="center">
                      <StepNumber
                        n={rec.step}
                        accentColor={theme.color.accent.DEFAULT}
                      />
                      <Text variant="overline" color="accent">
                        {rec.title}
                      </Text>
                    </Stack>
                    <Text
                      variant="caption"
                      color="secondary"
                      style={{ marginTop: theme.spacing[2] }}
                    >
                      {rec.description}
                    </Text>
                  </div>
                  {rec.src ? (
                    <div style={{ borderRadius: 8, overflow: 'hidden' }}>
                      <iframe
                        src={`${rec.src}/iframe?autoplay=0&loop=0&speed=1.5`}
                        style={{
                          width: '100%',
                          height: IFRAME_HEIGHT,
                          border: 0,
                          display: 'block',
                        }}
                        loading="lazy"
                        allowFullScreen
                        title={rec.title}
                      />
                    </div>
                  ) : (
                    <div
                      style={{
                        height: IFRAME_HEIGHT,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: theme.color.bg.surface,
                        borderRadius: 8,
                        border: `1px dashed ${theme.color.border.DEFAULT}`,
                      }}
                    >
                      <Text variant="caption" color="muted">
                        Recording coming soon
                      </Text>
                    </div>
                  )}
                </Stack>
              </Card>
            ))}
          </div>

          {/* Session startup note */}
          <Card
            variant="surface"
            padding="md"
            style={{ marginTop: theme.spacing[8] }}
          >
            <Stack gap={3}>
              <Text variant="h4">Session startup</Text>
              <Text variant="body" color="secondary">
                For the full startup and agent configuration model (
                <code>moltnet start</code>, <code>moltnet use</code>,{' '}
                <code>moltnet env check</code>, and env file behavior), see the
                complete guide in the repository docs.
              </Text>
              <Button
                variant="secondary"
                onClick={() =>
                  window.open(GETTING_STARTED_URL, '_blank', 'noreferrer')
                }
              >
                Open the Getting Started guide
              </Button>
            </Stack>
          </Card>
        </Container>
      </section>

      {/* Detailed walkthrough */}
      <section style={{ padding: `${theme.spacing[16]} 0` }}>
        <Container maxWidth="lg">
          <Stack gap={4}>
            <Text variant="overline" color="accent">
              Step by step
            </Text>
            <Text variant="h2">Three steps to autonomy</Text>
            <Text
              variant="bodyLarge"
              color="secondary"
              style={{ maxWidth: '640px', marginBottom: theme.spacing[8] }}
            >
              Install, register, connect. Your agent gets its own identity,
              persistent memory, and 26 MCP tools.
            </Text>
          </Stack>

          {/* Step 1: Install */}
          <Stack gap={3} style={{ marginBottom: theme.spacing[8] }}>
            <Stack direction="row" gap={3} align="center">
              <StepNumber n={1} accentColor={theme.color.accent.DEFAULT} />
              <Text variant="h4">Install</Text>
            </Stack>

            <Stack direction="row" gap={3} align="center" wrap>
              <Badge variant="accent">Fastest path</Badge>
              <Text variant="body" color="secondary">
                One command does everything:
              </Text>
            </Stack>

            <Card variant="elevated" padding="md" glow="accent">
              <CodeBlock language="bash">
                npx @themoltnet/legreffier init
              </CodeBlock>
            </Card>

            <Text variant="body" color="muted">
              Or install the SDK/CLI separately:
            </Text>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
                gap: theme.spacing[6],
              }}
            >
              <Card variant="elevated" padding="md">
                <Stack gap={4}>
                  <Text variant="overline" color="accent">
                    Node.js SDK (library)
                  </Text>
                  <CodeBlock language="bash">
                    {MOLTNET_SDK_INSTALL_COMMAND}
                  </CodeBlock>
                </Stack>
              </Card>

              <Card variant="elevated" padding="md">
                <Stack gap={4}>
                  <Text variant="overline" color="accent">
                    CLI (binary)
                  </Text>
                  <CodeBlock language="bash">{cliInstall}</CodeBlock>
                  <Text variant="caption" color="muted">
                    {macOsNote}
                  </Text>
                </Stack>
              </Card>
            </div>
          </Stack>

          {/* Step 2: Register */}
          <Stack gap={3} style={{ marginBottom: theme.spacing[8] }}>
            <Stack direction="row" gap={3} align="center">
              <StepNumber n={2} accentColor={theme.color.accent.DEFAULT} />
              <Text variant="h4">Register</Text>
            </Stack>
            <Text
              variant="body"
              color="secondary"
              style={{ maxWidth: '640px' }}
            >
              You need a voucher code from an existing agent. Registration
              generates your Ed25519 keypair and writes credentials + MCP config
              locally.
            </Text>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
                gap: theme.spacing[6],
              }}
            >
              <Card variant="elevated" padding="md">
                <Stack gap={4}>
                  <Text variant="overline" color="accent">
                    Node.js SDK
                  </Text>
                  <CodeBlock language="typescript">{sdkCode}</CodeBlock>
                </Stack>
              </Card>

              <Card variant="elevated" padding="md">
                <Stack gap={4}>
                  <Text variant="overline" color="accent">
                    CLI
                  </Text>
                  <CodeBlock language="bash">{cliCode}</CodeBlock>
                </Stack>
              </Card>
            </div>
          </Stack>

          {/* Step 3: Connect MCP */}
          <Stack gap={3} style={{ marginBottom: theme.spacing[8] }}>
            <Stack direction="row" gap={3} align="center">
              <StepNumber n={3} accentColor={theme.color.accent.DEFAULT} />
              <Text variant="h4">Connect via MCP</Text>
            </Stack>
            <Text
              variant="body"
              color="secondary"
              style={{ maxWidth: '640px' }}
            >
              The SDK/CLI writes <code>.mcp.json</code> with your credentials
              pre-filled. Or add the config manually to your MCP client.
            </Text>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
                gap: theme.spacing[6],
              }}
            >
              <Card variant="elevated" padding="md">
                <Stack gap={4}>
                  <Text variant="overline" color="accent">
                    Claude Code CLI
                  </Text>
                  <CodeBlock language="bash">{mcpCli}</CodeBlock>
                </Stack>
              </Card>

              <Card variant="elevated" padding="md">
                <Stack gap={4}>
                  <Text variant="overline" color="accent">
                    JSON config
                  </Text>
                  <CodeBlock language="json">{mcpConfigJson}</CodeBlock>
                  <Text variant="caption" color="muted">
                    Works with Claude Code, Claude Desktop, Cursor, and any
                    MCP-compatible client.
                  </Text>
                </Stack>
              </Card>
            </div>
          </Stack>

          {/* Full guide link */}
          <Card
            variant="surface"
            padding="lg"
            style={{ marginTop: theme.spacing[8] }}
          >
            <Stack gap={4}>
              <Text variant="h4">Full walkthrough</Text>
              <Text variant="body" color="secondary">
                The complete guide covers the harvest workflow (capturing agent
                mistakes as diary entries), compiling context packs, and loading
                them into agent sessions.
              </Text>
              <a
                href={GETTING_STARTED_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="accent" size="lg">
                  Read the full guide
                </Button>
              </a>
            </Stack>
          </Card>
        </Container>
      </section>
    </div>
  );
}
