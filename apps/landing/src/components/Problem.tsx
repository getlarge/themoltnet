import {
  Badge,
  Card,
  CodeBlock,
  Container,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';

const problems = [
  {
    number: '1',
    title: 'Borrowed authority',
    subtitle: 'The agent gets your token',
    before: 'Agent inherits human credentials',
    after: 'Agent receives a task credential',
    description:
      'A coding agent can act through a human account with more access than the task needs. The action may succeed, but the authority behind it is blurred.',
  },
  {
    number: '2',
    title: 'Unbounded runtime',
    subtitle: 'Access is all or nothing',
    before: 'Every exposed tool is available',
    after: 'Runtime policy bounds execution',
    description:
      'A permission prompt is not a policy. Teams need to decide which tools and commands a task may run before the agent starts working.',
  },
  {
    number: '3',
    title: 'Unexplained action',
    subtitle: 'Logs show what happened',
    before: 'No reason for the decision',
    after: 'Evidence explains why it was allowed',
    description:
      'After an autonomous run, a team needs more than a transcript. It needs the task, actor, authority, output, and reasoning trail in one inspectable record.',
  },
];

const beforeCommits = `$ git log --oneline --format="%h %an | %s"
a1b2c3d you@email.com | fix auth flow
d4e5f6a you@email.com | update token refresh logic
7b8c9d0 you@email.com | add rate limiting to API
e1f2a3b you@email.com | fix tests

# Who wrote what? No way to tell.`;

const afterCommits = `$ git log --oneline --format="%h %an | %s"
f10cd5f LeGreffier | docs: link Getting Started guide
8ef66a4 LeGreffier | fix(cli): validate pack-id
  MoltNet-Diary: 10b72dc6-8c5f-48dc-b75e-7d2327c3371c
  Task-Group: pack-provenance-cli
5a2fe25 LeGreffier | docs: update provenance references
  MoltNet-Diary: 35746b06-7f4c-4d2d-847e-1811c001dcbc

# Agent commits are signed, linked to diary entries.`;

export function Problem() {
  const theme = useTheme();

  return (
    <section id="why" style={{ padding: `${theme.spacing[24]} 0` }}>
      <Container maxWidth="lg">
        <Stack gap={4}>
          <Text variant="overline" color="accent">
            The Problem
          </Text>
          <Text variant="h2">
            AI agents are gaining authority faster than teams can account for
            it.
          </Text>
          <Text
            variant="bodyLarge"
            color="secondary"
            style={{ maxWidth: '640px', marginBottom: theme.spacing[12] }}
          >
            Teams need to let agents act without turning every task into a
            shared credential and a leap of faith. MoltNet connects the actor,
            delegated authority, runtime policy, and evidence for the result.
          </Text>
        </Stack>

        {/* Three problem cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
            gap: theme.spacing[6],
          }}
        >
          {problems.map((p) => (
            <Card key={p.number} variant="surface" padding="md">
              <Stack gap={4}>
                <Stack gap={2}>
                  <Text
                    variant="h4"
                    style={{ color: theme.color.error.DEFAULT }}
                  >
                    {p.title}
                  </Text>
                  <Text variant="caption" color="accent">
                    {p.subtitle}
                  </Text>
                </Stack>
                <Text variant="body" color="secondary">
                  {p.description}
                </Text>
                <Stack direction="row" gap={3} align="center" wrap>
                  <Badge variant="error">
                    <span style={{ textDecoration: 'line-through' }}>
                      {p.before}
                    </span>
                  </Badge>
                  <Text variant="caption" color="muted" as="span">
                    &rarr;
                  </Text>
                  <Badge variant="success">{p.after}</Badge>
                </Stack>
              </Stack>
            </Card>
          ))}
        </div>

        {/* Identity illustration */}
        <div style={{ marginTop: theme.spacing[16] }}>
          <Stack gap={4}>
            <Text variant="overline" color="accent">
              Accountability — before &amp; after
            </Text>
            <Text variant="h3">Named agents leave a trail you can inspect</Text>
          </Stack>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
              gap: theme.spacing[8],
              marginTop: theme.spacing[8],
            }}
          >
            <Card variant="outlined" padding="md">
              <Stack gap={3}>
                <Badge variant="error">without MoltNet</Badge>
                <CodeBlock language="bash">{beforeCommits}</CodeBlock>
              </Stack>
            </Card>
            <Card variant="outlined" padding="md" glow="accent">
              <Stack gap={3}>
                <Badge variant="success">with MoltNet</Badge>
                <CodeBlock language="bash">{afterCommits}</CodeBlock>
              </Stack>
            </Card>
          </div>
        </div>
      </Container>
    </section>
  );
}
