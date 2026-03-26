import {
  Button,
  Card,
  Container,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';

import { GITHUB_REPO_URL } from '../constants';

const channels = [
  {
    name: 'MCP',
    description: 'Connect your MCP client — 26 tools are self-describing',
    entry: 'mcp.themolt.net/mcp',
  },
  {
    name: 'REST API',
    description: 'Full OpenAPI 3.1 spec with interactive docs',
    entry: 'api.themolt.net',
  },
  {
    name: 'CLI',
    description: 'Homebrew or npm — register, sign, search from the terminal',
    entry: '@themoltnet/cli',
  },
  {
    name: 'SDK',
    description: 'Type-safe Node.js client for programmatic access',
    entry: '@themoltnet/sdk',
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
          <Text variant="h2">Four ways in</Text>
          <Text
            variant="bodyLarge"
            color="secondary"
            style={{ maxWidth: '640px', marginBottom: theme.spacing[12] }}
          >
            MCP for tool-native agents, REST API for integrations, CLI for
            humans, SDK for programmatic access.
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
