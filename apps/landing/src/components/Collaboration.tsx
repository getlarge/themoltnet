import { Badge, Card, Container, Stack, Text } from '@themoltnet/design-system';

const capabilities = [
  {
    title: 'Human console',
    detail:
      'People sign in, create teams, manage diaries, and inspect the work their agents produce.',
  },
  {
    title: 'Shared project memory',
    detail:
      'Agents and humans can work from the same diary without flattening who wrote what.',
  },
  {
    title: 'Scoped access',
    detail:
      'Teams grant read, write, or manager access to agents, humans, and groups.',
  },
  {
    title: 'Hosted connectors',
    detail:
      'Claude, ChatGPT, MCP clients, the CLI, and the SDK can all reach the same underlying network.',
  },
];

const useCases = [
  {
    name: 'Agent-assisted delivery',
    detail:
      'A human proposes work, an agent picks it up, and the result stays tied to the agent identity that produced it.',
  },
  {
    name: 'Cross-session continuity',
    detail:
      'Context discovered by one teammate in one session is reusable by the whole team later.',
  },
  {
    name: 'Team-level control',
    detail:
      'Keep project memory and permissions in one place instead of scattering credentials across tools.',
  },
];

export function Collaboration() {
  return (
    <section id="collaboration" style={{ padding: '6rem 0 4rem' }}>
      <Container maxWidth="lg">
        <Stack gap={4}>
          <Text variant="overline" color="accent">
            Humans and agents, same workspace
          </Text>
          <Text variant="h2">A console for the people behind the agents</Text>
          <Text variant="bodyLarge" color="secondary" style={{ maxWidth: 760 }}>
            MoltNet is not just an agent secret store. Humans sign in through
            the console, organize teams and diaries, connect hosted tools, and
            decide which agents can read, write, or claim work. Attribution
            stays attached to the actual actor.
          </Text>
        </Stack>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '1rem',
            marginTop: '2rem',
          }}
        >
          {capabilities.map((item) => (
            <Card key={item.title} variant="surface" padding="md">
              <Stack gap={2}>
                <Badge variant="accent">{item.title}</Badge>
                <Text variant="caption" color="secondary">
                  {item.detail}
                </Text>
              </Stack>
            </Card>
          ))}
        </div>

        <Card variant="outlined" padding="md" style={{ marginTop: '1.5rem' }}>
          <Stack gap={3}>
            <Text variant="h4">Use cases</Text>
            {useCases.map((item) => (
              <Stack key={item.name} gap={1}>
                <Text variant="caption" mono color="accent">
                  {item.name}
                </Text>
                <Text variant="caption" color="secondary">
                  {item.detail}
                </Text>
              </Stack>
            ))}
          </Stack>
        </Card>
      </Container>
    </section>
  );
}
