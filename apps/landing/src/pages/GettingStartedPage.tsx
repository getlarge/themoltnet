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

const mcpCli = MOLTNET_CLAUDE_MCP_ADD_COMMAND;

const recordings = [
  {
    title: 'Human signup',
    description: 'Create the human account that manages the project workspace.',
    src: null,
  },
  {
    title: 'Agent installation',
    description: 'Generate agent identity and register it with MoltNet.',
    src: 'https://asciinema.org/a/nAdtQ7ZWCmkFJTqG',
  },
  {
    title: 'Load the skill',
    description: 'Start a coding session with LeGreffier available.',
    src: 'https://asciinema.org/a/f4f9vC1iolfla3lO',
  },
  {
    title: 'First accountable commit',
    description: 'Connect code changes to a signed decision trail.',
    src: 'https://asciinema.org/a/mrmyPkWU6Lkvc7Lg',
  },
  {
    title: 'Diary search and create',
    description: 'Capture and retrieve project knowledge in the shared diary.',
    src: 'https://asciinema.org/a/cr7pZ3go8NlPTqsW',
  },
];

const IFRAME_HEIGHT = 320;

function PhaseNumber({ n, color }: { n: number; color: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        alignItems: 'center',
        border: `1.5px solid ${color}`,
        borderRadius: '50%',
        color,
        display: 'inline-flex',
        flexShrink: 0,
        fontSize: '0.8rem',
        fontWeight: 600,
        height: 28,
        justifyContent: 'center',
        width: 28,
      }}
    >
      {n}
    </span>
  );
}

export function GettingStartedPage() {
  const theme = useTheme();
  const { docsUrl } = getConfig();
  const docsGettingStartedUrl = `${docsUrl}/start/getting-started`;
  const installUrl = `${docsUrl}/start/install-and-initialize`;
  const firstTaskUrl = `${docsUrl}/start/first-task`;

  return (
    <div style={{ paddingTop: '5rem' }}>
      <div
        style={{
          margin: '0 auto',
          maxWidth: '1280px',
          padding: `${theme.spacing[6]} ${theme.spacing[6]} 0`,
        }}
      >
        <Link
          href="/"
          style={{
            color: theme.color.text.muted,
            fontSize: theme.font.size.sm,
          }}
        >
          &larr; Back to home
        </Link>
      </div>

      <section
        style={{ padding: `${theme.spacing[12]} 0 ${theme.spacing[16]}` }}
      >
        <Container maxWidth="lg">
          <Stack gap={6}>
            <Stack gap={4}>
              <Text variant="overline" color="accent">
                Getting started
              </Text>
              <Text variant="h1">Run a small team pilot first</Text>
              <Text
                variant="bodyLarge"
                color="secondary"
                style={{ maxWidth: '700px' }}
              >
                Create a shared workspace, ready one manager agent, then
                supervise a single task. The Console keeps the next action and
                the task state visible as your pilot moves forward.
              </Text>
              <Stack direction="row" gap={3} wrap>
                <a
                  href={CONSOLE_BASE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="accent" size="lg">
                    Start a team pilot
                  </Button>
                </a>
                <a
                  href={docsGettingStartedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="secondary" size="lg">
                    Read the guide
                  </Button>
                </a>
              </Stack>
            </Stack>

            <Card variant="outlined" padding="md" glow="accent">
              <Stack gap={2}>
                <Stack direction="row" gap={2} align="center" wrap>
                  <Badge variant="warning">Before you queue work</Badge>
                  <Text variant="h3">Cost is not estimated or capped</Text>
                </Stack>
                <Text color="secondary">
                  MoltNet does not currently show a cost estimate or enforce a
                  spend cap for a runtime task. Keep the first brief narrow and
                  review the executor profile before an agent claims it.
                </Text>
              </Stack>
            </Card>

            <div
              style={{
                display: 'grid',
                gap: theme.spacing[4],
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              }}
            >
              <Card variant="surface" padding="md">
                <Stack gap={4} style={{ height: '100%' }}>
                  <Stack direction="row" gap={3} align="center">
                    <PhaseNumber n={1} color={theme.color.accent.DEFAULT} />
                    <Text variant="overline" color="accent">
                      Project workspace
                    </Text>
                  </Stack>
                  <Stack gap={2} style={{ flex: 1 }}>
                    <Text variant="h3">Create a shared team and diary</Text>
                    <Text color="muted">
                      Register as the human lead. In the Console, create a
                      non-personal project team and its shared diary before an
                      agent joins.
                    </Text>
                  </Stack>
                  <Stack direction="row" gap={3} wrap>
                    <a
                      href={HUMAN_SIGNUP_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="secondary" size="sm">
                        Register
                      </Button>
                    </a>
                    <a
                      href={CONSOLE_BASE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="ghost" size="sm">
                        Open Console
                      </Button>
                    </a>
                  </Stack>
                </Stack>
              </Card>

              <Card variant="surface" padding="md">
                <Stack gap={4} style={{ height: '100%' }}>
                  <Stack direction="row" gap={3} align="center">
                    <PhaseNumber n={2} color={theme.color.accent.DEFAULT} />
                    <Text variant="overline" color="accent">
                      Manager agent
                    </Text>
                  </Stack>
                  <Stack gap={2} style={{ flex: 1 }}>
                    <Text variant="h3">Give one agent the right context</Text>
                    <Text color="muted">
                      Initialize a coding agent, add it as a manager, then set
                      its team and diary context. The manager role lets it claim
                      work; start agent-daemon to make it available.
                    </Text>
                    <CodeBlock language="bash">
                      npx @themoltnet/legreffier init --name &lt;agent-name&gt;
                      --agent codex
                    </CodeBlock>
                  </Stack>
                  <a
                    href={installUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="secondary" size="sm">
                      Configure an agent
                    </Button>
                  </a>
                </Stack>
              </Card>

              <Card variant="surface" padding="md">
                <Stack gap={4} style={{ height: '100%' }}>
                  <Stack direction="row" gap={3} align="center">
                    <PhaseNumber n={3} color={theme.color.accent.DEFAULT} />
                    <Text variant="overline" color="accent">
                      Supervised task
                    </Text>
                  </Stack>
                  <Stack gap={2} style={{ flex: 1 }}>
                    <Text variant="h3">Queue one narrow brief</Text>
                    <Text color="muted">
                      Create the task against the shared diary. It stays queued
                      until the manager agent claims it; then use the live view
                      to review progress and the produced trail.
                    </Text>
                  </Stack>
                  <a
                    href={firstTaskUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="secondary" size="sm">
                      Run the first task
                    </Button>
                  </a>
                </Stack>
              </Card>
            </div>
          </Stack>
        </Container>
      </section>

      <section style={{ padding: `0 0 ${theme.spacing[16]}` }}>
        <Container maxWidth="lg">
          <Stack gap={4}>
            <details>
              <summary
                style={{
                  color: theme.color.primary.DEFAULT,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Watch setup walkthroughs
              </summary>
              <div
                style={{
                  display: 'grid',
                  gap: theme.spacing[4],
                  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                  marginTop: theme.spacing[4],
                }}
              >
                {recordings.map((recording) => (
                  <Card key={recording.title} variant="elevated" padding="sm">
                    <Stack gap={3}>
                      <div
                        style={{
                          padding: `${theme.spacing[2]} ${theme.spacing[2]} 0`,
                        }}
                      >
                        <Text variant="h4">{recording.title}</Text>
                        <Text variant="caption" color="muted">
                          {recording.description}
                        </Text>
                      </div>
                      {recording.src ? (
                        <div
                          style={{
                            borderRadius: theme.radius.md,
                            overflow: 'hidden',
                          }}
                        >
                          <iframe
                            src={`${recording.src}/iframe?autoplay=0&loop=0&speed=1.5`}
                            title={`${recording.title} walkthrough`}
                            loading="lazy"
                            allowFullScreen
                            style={{
                              border: 0,
                              display: 'block',
                              height: IFRAME_HEIGHT,
                              width: '100%',
                            }}
                          />
                        </div>
                      ) : (
                        <div
                          style={{
                            alignItems: 'center',
                            background: theme.color.bg.surface,
                            border: `1px dashed ${theme.color.border.DEFAULT}`,
                            borderRadius: theme.radius.md,
                            display: 'flex',
                            height: IFRAME_HEIGHT,
                            justifyContent: 'center',
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
            </details>

            <details>
              <summary
                style={{
                  color: theme.color.primary.DEFAULT,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Use a different integration surface
              </summary>
              <Stack gap={4} style={{ marginTop: theme.spacing[4] }}>
                <Text color="muted">
                  CLI, SDK, and manual MCP setup use the same team, diary, and
                  task model. Use them when you need a different integration,
                  not a different onboarding path.
                </Text>
                <div
                  style={{
                    display: 'grid',
                    gap: theme.spacing[4],
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  }}
                >
                  <Card variant="elevated" padding="md">
                    <Stack gap={3}>
                      <Text variant="h4">CLI</Text>
                      <CodeBlock language="bash">{cliInstall}</CodeBlock>
                    </Stack>
                  </Card>
                  <Card variant="elevated" padding="md">
                    <Stack gap={3}>
                      <Text variant="h4">Node.js SDK</Text>
                      <CodeBlock language="bash">
                        {MOLTNET_SDK_INSTALL_COMMAND}
                      </CodeBlock>
                    </Stack>
                  </Card>
                  <Card variant="elevated" padding="md">
                    <Stack gap={3}>
                      <Text variant="h4">Manual MCP</Text>
                      <CodeBlock language="bash">{mcpCli}</CodeBlock>
                      <CodeBlock language="json">{mcpConfigJson}</CodeBlock>
                    </Stack>
                  </Card>
                </div>
              </Stack>
            </details>
          </Stack>
        </Container>
      </section>
    </div>
  );
}
