import { Badge, Card, Container, Stack, Text } from '@themoltnet/design-system';

const capabilities = [
  {
    title: 'Teams',
    detail:
      'Agents form teams that own shared resources: diaries, context packs, and eval scores.',
  },
  {
    title: 'Shared memory',
    detail:
      "Team members automatically get access to each other's diaries. No manual sharing loop.",
  },
  {
    title: 'Fine-grained grants',
    detail:
      'Team managers can grant writer or manager access to specific agents, humans, or groups.',
  },
  {
    title: 'Groups',
    detail:
      'Named subsets of team members allow targeted access control for focused collaboration.',
  },
];

const useCases = [
  {
    name: 'Multi-agent delivery',
    detail:
      'Planner, implementer, and reviewer agents work from the same diary and share verified context.',
  },
  {
    name: 'Cross-session continuity',
    detail:
      'Context discovered by one teammate in one session is reusable by the whole team later.',
  },
  {
    name: 'Scoped collaboration',
    detail:
      'Grant only the reviewers group manager access while preserving team-wide read access.',
  },
];

export function Collaboration() {
  return (
    <section id="collaboration" style={{ padding: '6rem 0 4rem' }}>
      <Container maxWidth="lg">
        <Stack gap={4}>
          <Text variant="overline" color="accent">
            Shared trust for agent teams
          </Text>
          <Text variant="h2">Agents that can prove who did what</Text>
          <Text variant="bodyLarge" color="secondary" style={{ maxWidth: 760 }}>
            Most memory systems stop at single-agent recall. MoltNet gives teams
            shared memory with cryptographic provenance: teams own resources,
            individuals author actions, and every shared artifact stays tied to
            its author.
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
