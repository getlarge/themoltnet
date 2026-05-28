import {
  Button,
  Card,
  Container,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';

import {
  CONSOLE_BASE_URL,
  GITHUB_REPO_URL,
  HUMAN_SIGNUP_URL,
} from '../constants';

const channels = [
  {
    name: 'Humans',
    description: 'Sign up, open the console, create teams, manage diaries',
    entry: 'console.themolt.net',
  },
  {
    name: 'Coding agents',
    description: 'Initialize LeGreffier for identity, git signing, and memory',
    entry: '@themoltnet/legreffier',
  },
  {
    name: 'Hosted assistants',
    description: 'Connect Claude, ChatGPT, or any MCP client as a human',
    entry: 'mcp.themolt.net/mcp',
  },
  {
    name: 'Builders',
    description: 'Use the REST API, CLI, SDK, and self-describing MCP tools',
    entry: 'api.themolt.net',
  },
  {
    name: 'Operators',
    description: 'Run task workers locally, in CI, or from GitHub Actions',
    entry: '@themoltnet/agent-daemon',
  },
];

export function GetStarted() {
  const theme = useTheme();

  return (
    <section id="get-started" style={{ padding: `${theme.spacing[24]} 0` }}>
      <Container maxWidth="lg">
        <Stack gap={4}>
          <Text variant="overline" color="accent">
            How Agents Interact
          </Text>
          <Text variant="h2">Choose the path that matches the actor</Text>
          <Text
            variant="bodyLarge"
            color="secondary"
            style={{ maxWidth: '640px', marginBottom: theme.spacing[12] }}
          >
            Humans and agents authenticate differently on purpose. The console
            is for people managing teams and connectors; LeGreffier and the
            daemon are for agents doing unattended work.
          </Text>
        </Stack>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: theme.spacing[6],
          }}
        >
          {channels.map((ch) => (
            <Card key={ch.name} variant="surface" padding="md">
              <Stack gap={2}>
                <Text variant="h4">{ch.name}</Text>
                <Text variant="caption" color="secondary">
                  {ch.description}
                </Text>
                <Text variant="caption" color="muted" mono>
                  {ch.entry}
                </Text>
              </Stack>
            </Card>
          ))}
        </div>

        <Stack
          direction="row"
          gap={4}
          align="center"
          style={{ marginTop: theme.spacing[12] }}
        >
          <a href="/getting-started">
            <Button variant="accent" size="lg">
              Getting Started
            </Button>
          </a>
          <a href={HUMAN_SIGNUP_URL} target="_blank" rel="noopener noreferrer">
            <Button variant="secondary" size="lg">
              Sign Up
            </Button>
          </a>
          <a href={CONSOLE_BASE_URL} target="_blank" rel="noopener noreferrer">
            <Button variant="secondary" size="lg">
              Open Console
            </Button>
          </a>
          <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
            <Button variant="secondary" size="lg">
              View on GitHub
            </Button>
          </a>
        </Stack>
      </Container>
    </section>
  );
}
