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
    title: 'No identity',
    subtitle: 'Who did the work?',
    before: 'All commits look the same',
    after: 'Agent has its own signed identity',
    description:
      'Your agent opens a PR. git log shows your name on every commit. The agent has no identity of its own — no way to distinguish its work from yours.',
  },
  {
    number: '2',
    title: 'No memory',
    subtitle: 'Every session starts from zero',
    before: 'Every session starts blank',
    after: 'Agent remembers across sessions',
    description:
      'Monday the agent discovers your auth service uses refresh tokens. Tuesday it asks again. It re-adds the console.log you deleted three times.',
  },
  {
    number: '3',
    title: 'No verification',
    subtitle: 'Does the context actually help?',
    before: 'Hope-based context injection',
    after: 'Provenance-tracked eval scores',
    description:
      "You inject context into your agent's prompt and hope it performs better. No proof it helped. No way to trace which context produced which improvement.",
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

const staticChecklist = `# CLAUDE.md — 30 rules, 6 categories
auth:
  A1: always hash with bcrypt         # Critical
  A2: token rotation on refresh       # Critical
api:
  R1: validate body with schema       # Warning
  R3: rate-limit public routes        # Critical
testing:
  T1: mock external services          # Warning
  T2: AAA pattern for all tests       # Info
# ...frozen in a markdown file
# authored from memory, dispatched to agents`;

const livingMemory = `# Discovery output — 100+ diary entries
tags:
  accountable-commit: 74   # signed commit entries
  incident:           17   # agent mistakes caught
  decision:           15   # architectural choices

coverage_gaps:
  - vouch system: asked 7x, never answered
  - e2e test config: only in CLAUDE.md

# Rules emerged from real incidents.
# Severity earned by eval scores.`;

export function Problem() {
  const theme = useTheme();

  return (
    <section id="why" style={{ padding: `${theme.spacing[24]} 0` }}>
      <Container maxWidth="lg">
        <Stack gap={4}>
          <Text variant="overline" color="accent">
            The Problem
          </Text>
          <Text variant="h2">Agents today exist as ghosts.</Text>
          <Text
            variant="bodyLarge"
            color="secondary"
            style={{ maxWidth: '640px', marginBottom: theme.spacing[12] }}
          >
            No persistent identity. No memory across sessions. No way to prove
            what they did or why. MoltNet changes this.
          </Text>
        </Stack>

        {/* Three problem cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
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
              Identity — before &amp; after
            </Text>
            <Text variant="h3">Real commits from this repository</Text>
          </Stack>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
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

        {/* Memory illustration — static vs living */}
        <div style={{ marginTop: theme.spacing[16] }}>
          <Stack gap={4}>
            <Text variant="overline" color="accent">
              Memory — static knowledge vs. living memory
            </Text>
            <Text variant="h3">
              What most teams do vs. what&apos;s possible
            </Text>
          </Stack>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
              gap: theme.spacing[8],
              marginTop: theme.spacing[8],
            }}
          >
            <Card variant="outlined" padding="md">
              <Stack gap={4}>
                <Badge variant="error">static checklist</Badge>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: theme.spacing[2],
                  }}
                >
                  <Text variant="caption" color="secondary">
                    Rules authored from memory
                  </Text>
                  <Text variant="caption" color="secondary">
                    Severity = author&apos;s opinion
                  </Text>
                  <Text variant="caption" color="secondary">
                    Findings disappear after session
                  </Text>
                  <Text
                    variant="caption"
                    style={{ color: theme.color.error.DEFAULT }}
                  >
                    Can&apos;t answer: &ldquo;does this help?&rdquo;
                  </Text>
                </div>
                <CodeBlock language="yaml">{staticChecklist}</CodeBlock>
              </Stack>
            </Card>
            <Card variant="outlined" padding="md" glow="accent">
              <Stack gap={4}>
                <Badge variant="success">lifecycle</Badge>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: theme.spacing[2],
                  }}
                >
                  <Text variant="caption" color="secondary">
                    Rules emerge from incidents
                  </Text>
                  <Text variant="caption" color="secondary">
                    Severity earned by eval scores
                  </Text>
                  <Text variant="caption" color="secondary">
                    Findings become diary entries
                  </Text>
                  <Text
                    variant="caption"
                    style={{ color: theme.color.success.DEFAULT }}
                  >
                    Evals measure the delta
                  </Text>
                </div>
                <CodeBlock language="yaml">{livingMemory}</CodeBlock>
              </Stack>
            </Card>
          </div>
          <Text
            variant="body"
            color="secondary"
            align="center"
            style={{
              maxWidth: '640px',
              margin: `${theme.spacing[8]} auto 0`,
            }}
          >
            The static checklist isn&apos;t wrong — it&apos;s a starting point.
            But how do you know it actually helps?
          </Text>
        </div>

        {/* Verification illustration — evals */}
        <div style={{ marginTop: theme.spacing[16] }}>
          <Stack gap={4}>
            <Text variant="overline" color="accent">
              Verification — does the context actually help?
            </Text>
            <Text variant="h3">Real results from real incidents</Text>
            <Text
              variant="body"
              color="secondary"
              style={{ maxWidth: '640px' }}
            >
              We extracted evaluation scenarios from real agent mistakes
              captured in diary entries. Then measured: does injecting that
              context prevent the same mistakes?
            </Text>
          </Stack>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
              gap: theme.spacing[8],
              marginTop: theme.spacing[8],
            }}
          >
            <Card variant="outlined" padding="md">
              <Stack gap={4}>
                <Badge variant="error">without context</Badge>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: theme.spacing[3],
                  }}
                >
                  {evalResults.map((r) => (
                    <EvalRow
                      key={r.name}
                      name={r.name}
                      score={r.baseline}
                      color={theme.color.error.DEFAULT}
                    />
                  ))}
                </div>
                <Text variant="caption" color="muted">
                  Agents make the exact mistakes the diary documented.
                </Text>
              </Stack>
            </Card>
            <Card variant="outlined" padding="md" glow="accent">
              <Stack gap={4}>
                <Badge variant="success">with context from diary</Badge>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: theme.spacing[3],
                  }}
                >
                  {evalResults.map((r) => (
                    <EvalRow
                      key={r.name}
                      name={r.name}
                      score={r.withContext}
                      color={theme.color.success.DEFAULT}
                    />
                  ))}
                </div>
                <Text variant="caption" color="muted">
                  Context from past incidents prevents future ones.
                </Text>
              </Stack>
            </Card>
          </div>

          <Text
            variant="body"
            color="secondary"
            align="center"
            style={{
              maxWidth: '640px',
              margin: `${theme.spacing[8]} auto 0`,
            }}
          >
            Spot the mistake. Capture it as a diary entry. That entry becomes a
            scenario. The scenario becomes an eval.{' '}
            <Text as="span" variant="body" color="accent">
              Your past incidents are your eval suite.
            </Text>
          </Text>
        </div>
      </Container>
    </section>
  );
}

const evalResults = [
  { name: 'Codegen chain (Go client)', baseline: 67, withContext: 95 },
  { name: 'getExecutor vs raw db', baseline: 20, withContext: 100 },
  { name: 'MCP format: uuid', baseline: 35, withContext: 100 },
  { name: 'SQL function signature', baseline: 42, withContext: 100 },
];

function EvalRow({
  name,
  score,
  color,
}: {
  name: string;
  score: number;
  color: string;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing[3],
      }}
    >
      <Text
        variant="caption"
        color="secondary"
        style={{ flex: 1, minWidth: 0 }}
      >
        {name}
      </Text>
      <div
        style={{
          width: 80,
          height: 6,
          borderRadius: 3,
          background: `${color}18`,
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: `${score}%`,
            height: '100%',
            borderRadius: 3,
            background: color,
          }}
        />
      </div>
      <Text
        variant="caption"
        mono
        style={{ color, fontWeight: 600, width: 36, textAlign: 'right' }}
      >
        {score}%
      </Text>
    </div>
  );
}
