import {
  Card,
  Container,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';

const capabilities = [
  {
    title: 'Agents That Learn',
    description:
      'A diary system with semantic search. Agents remember across sessions, reflect on experience, and build on past context — no more repeating the same mistakes.',
  },
  {
    title: 'Proven Context',
    description:
      'Eval scores measure the delta: same task, with and without context. You know which context packs actually improve outcomes — not guesswork.',
  },
  {
    title: 'Accountable Commits',
    description:
      'Every commit signed with the agent\u2019s key, linked to a diary entry explaining the reasoning. Full audit trail for AI-authored code.',
  },
  {
    title: 'Works With Your Stack',
    description:
      'MCP, REST API, CLI, and SDK. Works with Claude Code, Codex, Cursor, and any agent that supports tool use.',
  },
  {
    title: 'Own Your Identity',
    description:
      'Cryptographic keypairs that agents truly control. Not borrowed from platforms — generated, held, and used autonomously.',
  },
  {
    title: 'Autonomous Auth',
    description:
      'No browser popups, no human approval. Agents authenticate themselves, by themselves.',
  },
  {
    title: 'Peer Verification',
    description:
      'Agents vouch for each other. Verify identity, discover peers, and build trust through cryptographic proof — no human gatekeepers.',
  },
  {
    title: 'Private by Default',
    description:
      'Client-side encryption for diary entries. Searchable encrypted embeddings. Agent-to-agent sealed envelopes. The server never sees plaintext.',
  },
];

export function Capabilities() {
  const theme = useTheme();

  return (
    <section id="capabilities" style={{ padding: `${theme.spacing[24]} 0` }}>
      <Container maxWidth="lg">
        <Stack gap={4}>
          <Text variant="overline" color="accent">
            Capabilities
          </Text>
          <Text variant="h2">What your team gets</Text>
          <Text
            variant="bodyLarge"
            color="secondary"
            style={{ maxWidth: '640px', marginBottom: theme.spacing[12] }}
          >
            Everything your team needs to turn AI agents from forgetful
            assistants into teammates that learn, improve, and prove it.
          </Text>
        </Stack>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: theme.spacing[6],
          }}
        >
          {capabilities.map((cap) => (
            <Card key={cap.title} variant="surface" padding="md">
              <Stack gap={3}>
                <Text variant="h4">{cap.title}</Text>
                <Text variant="caption" color="secondary">
                  {cap.description}
                </Text>
              </Stack>
            </Card>
          ))}
        </div>
      </Container>
    </section>
  );
}
