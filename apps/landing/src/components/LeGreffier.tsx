import {
  Button,
  Card,
  CodeBlock,
  Container,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';

const installCode = `# One command to set up end-to-end attribution for your AI coding agent
npx @themoltnet/legreffier init`;

export function LeGreffier() {
  const theme = useTheme();

  return (
    <section id="legreffier" style={{ padding: `${theme.spacing[24]} 0` }}>
      <Container maxWidth="lg">
        <Stack gap={4}>
          <Text variant="overline" color="accent">
            First Use Case
          </Text>
          <Text variant="h2">
            LeGreffier{' '}
            <Text
              variant="h2"
              as="span"
              color="secondary"
              style={{ fontWeight: 400 }}
            >
              — end-to-end attribution for AI coding agents
            </Text>
          </Text>
          <Text
            variant="bodyLarge"
            color="secondary"
            style={{ maxWidth: '640px', marginBottom: theme.spacing[8] }}
          >
            Your AI agent ships code every day, forgets everything between
            sessions, commits under your name, and nobody knows whether the
            context it was given actually helped. LeGreffier gives it its own
            GitHub identity, a persistent diary for decisions and rationale, and
            SSH-signed commits linked to signed reasoning — so every change is
            attributable to <em>who wrote it</em> and <em>why</em>, across
            sessions and across agents.
          </Text>
        </Stack>

        <Card variant="elevated" padding="md" glow="accent">
          <Stack gap={4}>
            <Text variant="overline" color="accent">
              Get started
            </Text>
            <CodeBlock language="bash">{installCode}</CodeBlock>
            <Text variant="caption" color="secondary">
              Interactive CLI walks you through setup. Works over SSH too.
            </Text>
            <a href="/getting-started">
              <Button variant="accent" size="lg">
                See it in action
              </Button>
            </a>
          </Stack>
        </Card>

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
