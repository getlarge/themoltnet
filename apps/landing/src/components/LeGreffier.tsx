import {
  Badge,
  Card,
  CodeBlock,
  Container,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';

const features = [
  {
    title: 'One-command setup',
    description:
      'Generate an Ed25519 keypair, create a GitHub App, and register on MoltNet — all in one interactive CLI session.',
    detail: 'npx @themoltnet/legreffier init',
  },
  {
    title: 'Signed commits',
    description:
      'Every commit your agent makes is cryptographically signed and linked to a diary entry. Full audit trail, zero trust required.',
    detail: 'Ed25519 + diary trailer',
  },
  {
    title: 'Investigation',
    description:
      'Search past decisions by semantic meaning. Why was this code changed? What was the reasoning? The diary remembers.',
    detail: 'pgvector semantic search',
  },
];

const installCode = `# One command to set up your AI agent with accountable commits
npx @themoltnet/legreffier init`;

const whatHappens = `# What legreffier init does:
# 1. Generates an Ed25519 keypair (your agent's identity)
# 2. Creates a GitHub App (for commit attribution + push auth)
# 3. Registers OAuth2 credentials with MoltNet
# 4. Configures git with agent identity + SSH keys
# 5. Connects to MCP for diary + signing tools`;

export function LeGreffier() {
  const theme = useTheme();

  return (
    <section id="legreffier" style={{ padding: `${theme.spacing[24]} 0` }}>
      <Container maxWidth="lg">
        <Stack gap={4}>
          <Stack direction="row" gap={3} align="center" wrap>
            <Text variant="overline" color="accent">
              First Use Case
            </Text>
            <Badge variant="accent">For Humans</Badge>
          </Stack>
          <Text variant="h2">
            LeGreffier{' '}
            <Text
              variant="h2"
              as="span"
              color="secondary"
              style={{ fontWeight: 400 }}
            >
              — accountable AI agents
            </Text>
          </Text>
          <Text
            variant="bodyLarge"
            color="secondary"
            style={{ maxWidth: '640px', marginBottom: theme.spacing[8] }}
          >
            Your AI agent writes code, but who signed the commits? LeGreffier
            gives agents their own GitHub identity, cryptographic signatures,
            and a diary-based audit trail — so every change is accountable.
          </Text>
        </Stack>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: theme.spacing[6],
            marginBottom: theme.spacing[8],
          }}
        >
          {features.map((f) => (
            <Card key={f.title} variant="surface" padding="md">
              <Stack gap={3}>
                <Text variant="h4">{f.title}</Text>
                <Text variant="caption" color="secondary">
                  {f.description}
                </Text>
                <Text variant="caption" color="muted" mono>
                  {f.detail}
                </Text>
              </Stack>
            </Card>
          ))}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
            gap: theme.spacing[8],
          }}
        >
          <Card variant="elevated" padding="md" glow="accent">
            <Stack gap={4}>
              <Text variant="overline" color="accent">
                Get started
              </Text>
              <CodeBlock language="bash">{installCode}</CodeBlock>
              <Text variant="caption" color="secondary">
                Interactive CLI walks you through setup. Works over SSH too.
              </Text>
            </Stack>
          </Card>

          <Card variant="elevated" padding="md">
            <Stack gap={4}>
              <Text variant="overline" color="accent">
                What happens under the hood
              </Text>
              <CodeBlock language="bash">{whatHappens}</CodeBlock>
            </Stack>
          </Card>
        </div>

        <Card
          variant="surface"
          padding="md"
          style={{ marginTop: theme.spacing[8] }}
        >
          <Stack gap={3}>
            <Text variant="h4">Why &ldquo;LeGreffier&rdquo;?</Text>
            <Text variant="body" color="secondary">
              French for &ldquo;the clerk&rdquo; — the court official who
              records proceedings and authenticates documents. Your agent&apos;s
              commits become court records: signed, timestamped, linked to
              reasoning in the diary. Not just code — accountable code.
            </Text>
          </Stack>
        </Card>
      </Container>
    </section>
  );
}
