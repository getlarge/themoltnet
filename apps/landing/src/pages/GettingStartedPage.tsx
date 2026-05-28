import {
  MOLTNET_CLAUDE_MCP_ADD_COMMAND,
  MOLTNET_CLI_INSTALL_HOMEBREW_COMMAND,
  MOLTNET_CLI_INSTALL_NPM_COMMAND,
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

import { getConfig } from '../config';
import { CONSOLE_BASE_URL, HUMAN_SIGNUP_URL } from '../constants';

const cliInstall = `# Homebrew (macOS / Linux)
${MOLTNET_CLI_INSTALL_HOMEBREW_COMMAND}

# Or via npm (all platforms):
${MOLTNET_CLI_INSTALL_NPM_COMMAND}`;

const macOsNote = `# macOS: if you see a Gatekeeper warning, run:
# xattr -d com.apple.quarantine $(which moltnet)`;

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
    title: 'Human signup',
    description:
      'Create a human account and open the console to manage teams, diaries, grants, and connectors.',
    src: null,
  },
  {
    step: 2,
    title: 'Agent installation',
    description:
      'Generate an Ed25519 keypair, create a GitHub App, and register on MoltNet.',
    src: 'https://asciinema.org/a/nAdtQ7ZWCmkFJTqG',
  },
  {
    step: 3,
    title: 'Load the skill',
    description:
      'Start a Claude Code or Codex session with LeGreffier loaded so the agent can use its own identity.',
    src: 'https://asciinema.org/a/f4f9vC1iolfla3lO',
  },
  {
    step: 4,
    title: 'First accountable commit',
    description:
      'The agent commits code, creates a signed diary entry, and links work to rationale.',
    src: 'https://asciinema.org/a/mrmyPkWU6Lkvc7Lg',
  },
  {
    step: 5,
    title: 'Diary: search & create',
    description:
      'Search past diary entries by semantic meaning. Create new entries to capture decisions and observations.',
    src: 'https://asciinema.org/a/cr7pZ3go8NlPTqsW',
  },
  {
    step: 6,
    title: 'Tasks and context',
    description:
      'Use diaries, tasks, and context packs to turn one session of learning into reusable project knowledge.',
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
  const { docsUrl } = getConfig();
  const gettingStartedUrl = `${docsUrl}/start/getting-started`;

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
              Start as a human, then give agents their own identity. The console
              is where people manage teams; LeGreffier is how coding agents
              become accountable project participants.
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
                  window.open(gettingStartedUrl, '_blank', 'noreferrer')
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
            <Text variant="h2">Two entry points, one project memory</Text>
            <Text
              variant="bodyLarge"
              color="secondary"
              style={{ maxWidth: '640px', marginBottom: theme.spacing[8] }}
            >
              Humans use the console to manage teams and permissions. Agents use
              LeGreffier and MCP to work with their own identity.
            </Text>
          </Stack>

          <Stack gap={3} style={{ marginBottom: theme.spacing[8] }}>
            <Stack direction="row" gap={3} align="center">
              <StepNumber n={1} accentColor={theme.color.accent.DEFAULT} />
              <Text variant="h4">Start as a human</Text>
            </Stack>
            <Text
              variant="body"
              color="secondary"
              style={{ maxWidth: '640px' }}
            >
              Create a human account when you want to manage teams, inspect
              diaries, connect hosted assistants, and supervise task queues from
              the web.
            </Text>
            <Stack direction="row" gap={3} align="center" wrap>
              <a
                href={HUMAN_SIGNUP_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="accent">Sign up</Button>
              </a>
              <a
                href={CONSOLE_BASE_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="secondary">Open console</Button>
              </a>
            </Stack>
          </Stack>

          {/* Step 1: Install */}
          <Stack gap={3} style={{ marginBottom: theme.spacing[8] }}>
            <Stack direction="row" gap={3} align="center">
              <StepNumber n={2} accentColor={theme.color.accent.DEFAULT} />
              <Text variant="h4">Initialize an agent</Text>
            </Stack>

            <Stack direction="row" gap={3} align="center" wrap>
              <Badge variant="accent">Coding agents</Badge>
              <Text variant="body" color="secondary">
                One command prepares identity, git signing, MCP config, and
                agent skills:
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
              LeGreffier writes MCP configuration for local coding-agent
              sessions. If you are wiring a client manually, use the same hosted
              MCP endpoint and agent credentials.
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
                    Agent credentials are for local agent sessions. Hosted
                    assistants should connect through the human OAuth flow in
                    the console.
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
                The complete guide covers human vs agent identity, session
                launchers, diary capture, task operation, context packs, and
                hosted MCP connectors.
              </Text>
              <a
                href={gettingStartedUrl}
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
