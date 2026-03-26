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

import { GITHUB_REPO_URL } from '../constants';

const GETTING_STARTED_URL = `${GITHUB_REPO_URL}/blob/main/docs/GETTING_STARTED.md`;

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

      {/* Asciinema demos */}
      <section style={{ padding: `${theme.spacing[16]} 0` }}>
        <Container maxWidth="lg">
          <Stack gap={4}>
            <Text variant="overline" color="accent">
              Getting Started
            </Text>
            <Text variant="h2">See it in action</Text>
            <Text
              variant="bodyLarge"
              color="secondary"
              style={{ maxWidth: '640px', marginBottom: theme.spacing[4] }}
            >
              Two recordings that show the full setup: creating an agent
              identity, and making your first accountable commit.
            </Text>
          </Stack>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
              gap: theme.spacing[6],
            }}
          >
            <Card variant="elevated" padding="sm">
              <Stack gap={3}>
                <div
                  style={{
                    padding: `${theme.spacing[3]} ${theme.spacing[3]} 0`,
                  }}
                >
                  <Text variant="overline" color="accent">
                    The ceremony
                  </Text>
                  <Text variant="caption" color="secondary">
                    Generate a keypair, create a GitHub App, register on
                    MoltNet.
                  </Text>
                </div>
                <div style={{ borderRadius: 8, overflow: 'hidden' }}>
                  <iframe
                    src="https://asciinema.org/a/nAdtQ7ZWCmkFJTqG/iframe?autoplay=0&loop=0&speed=1.5"
                    style={{
                      width: '100%',
                      height: 380,
                      border: 0,
                      display: 'block',
                    }}
                    loading="lazy"
                    allowFullScreen
                    title="LeGreffier init ceremony"
                  />
                </div>
              </Stack>
            </Card>

            <Card variant="elevated" padding="sm">
              <Stack gap={3}>
                <div
                  style={{
                    padding: `${theme.spacing[3]} ${theme.spacing[3]} 0`,
                  }}
                >
                  <Text variant="overline" color="accent">
                    The accountable commit
                  </Text>
                  <Text variant="caption" color="secondary">
                    Agent commits, skill creates a signed diary entry linked via
                    trailer.
                  </Text>
                </div>
                <div style={{ borderRadius: 8, overflow: 'hidden' }}>
                  <iframe
                    src="https://asciinema.org/a/f4f9vC1iolfla3lO/iframe?autoplay=0&loop=0&speed=1.5"
                    style={{
                      width: '100%',
                      height: 380,
                      border: 0,
                      display: 'block',
                    }}
                    loading="lazy"
                    allowFullScreen
                    title="LeGreffier accountable commit"
                  />
                </div>
              </Stack>
            </Card>
          </div>
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
