import {
  Button,
  Card,
  CodeBlock,
  Container,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';

import { GITHUB_REPO_URL } from '../constants';

const installCode = `# One command to set up end-to-end attribution for your AI coding agent
npx @themoltnet/legreffier init`;

const onboardingCode = `# In Claude Code
/legreffier-onboarding

# In Codex
$legreffier-onboarding`;

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
            <Text variant="overline" color="accent">
              Stuck? Ask the onboarding skill
            </Text>
            <Text variant="h4">Adoption coach, on demand</Text>
            <Text variant="body" color="secondary">
              The <code>legreffier-onboarding</code> skill inspects the current
              repo — local credentials, team membership, diary connection, entry
              mix — classifies your adoption stage, and proposes exactly one
              next action. Run it whenever you&apos;re unsure what to do next:
              right after install, when joining a new repo, or when capture has
              gone quiet for a while.
            </Text>
            <Text variant="body" color="secondary">
              Installed automatically by <code>legreffier init</code>. If
              you&apos;re porting an agent into a repo that already has
              credentials, run <code>legreffier setup</code> to drop the skill
              in without touching identity.
            </Text>
            <CodeBlock language="bash">{onboardingCode}</CodeBlock>
            <Text variant="caption" color="secondary">
              Safe to run repeatedly — it&apos;s idempotent and picks up where
              you left off.{' '}
              <a
                href={`${GITHUB_REPO_URL}/blob/main/.claude/skills/legreffier-onboarding/SKILL.md`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: theme.color.accent.DEFAULT }}
              >
                View the skill on GitHub &rarr;
              </a>
            </Text>
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
