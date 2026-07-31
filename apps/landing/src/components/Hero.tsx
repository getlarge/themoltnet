import {
  Badge,
  Container,
  Logo,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';

import { CONSOLE_BASE_URL, GITHUB_REPO_URL } from '../constants';

export function Hero() {
  const theme = useTheme();

  return (
    <section
      style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: theme.spacing[20],
        background: `radial-gradient(ellipse 600px 400px at 50% 0%, ${theme.color.primary.muted}, transparent)`,
      }}
    >
      <Container maxWidth="lg" style={{ position: 'relative', zIndex: 1 }}>
        <Stack gap={6} align="center">
          <Logo size={150} />

          <Badge variant="accent">
            Accountable authority for autonomous agents
          </Badge>

          <Text
            variant="h1"
            align="center"
            style={{
              fontSize: 'clamp(2.5rem, 6vw, 4.5rem)',
              textShadow: `0 0 20px ${theme.color.accent.muted}, 0 0 40px ${theme.color.accent.subtle}`,
            }}
          >
            Agents should not
            <br />
            <span
              style={{
                color: theme.color.accent.DEFAULT,
              }}
            >
              inherit your authority.
            </span>
          </Text>

          <Text
            variant="bodyLarge"
            color="secondary"
            align="center"
            style={{ maxWidth: '640px' }}
          >
            MoltNet gives autonomous agents their own identity, task-scoped
            credentials, and runtime policies that bound the tools and commands
            each task may run. Let them do real work—and inspect who acted and
            what they were allowed to do.
          </Text>

          <ol
            aria-label="MoltNet authority chain"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              alignItems: 'center',
              gap: theme.spacing[2],
              margin: 0,
              maxWidth: '760px',
              padding: 0,
              fontFamily: theme.font.family.mono,
              fontSize: theme.font.size.xs,
              color: theme.color.text.secondary,
              listStyle: 'none',
            }}
          >
            <AuthorityStep label="agent key" tone="accent" showArrow />
            <AuthorityStep label="task credential" tone="primary" showArrow />
            <AuthorityStep label="runtime policy" tone="primary" showArrow />
            <AuthorityStep label="attributable evidence" tone="accent" />
          </ol>

          <a
            href="/getting-started"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '48px',
              padding: `${theme.spacing[3]} ${theme.spacing[5]}`,
              borderRadius: theme.radius.md,
              background: theme.color.accent.DEFAULT,
              color: theme.color.text.inverse,
              fontWeight: theme.font.weight.semibold,
              textDecoration: 'none',
            }}
          >
            Start a team pilot
          </a>

          <Text variant="caption" color="secondary" align="center">
            Already set up?{' '}
            <a
              href={CONSOLE_BASE_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: theme.color.primary.DEFAULT }}
            >
              Open Console
            </a>{' '}
            or{' '}
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: theme.color.primary.DEFAULT }}
            >
              view the source
            </a>
          </Text>
        </Stack>
      </Container>
    </section>
  );
}

function AuthorityStep({
  label,
  tone,
  showArrow = false,
}: {
  label: string;
  tone: 'accent' | 'primary';
  showArrow?: boolean;
}) {
  const theme = useTheme();
  const color =
    tone === 'accent'
      ? theme.color.accent.DEFAULT
      : theme.color.primary.DEFAULT;
  const background =
    tone === 'accent' ? theme.color.accent.muted : theme.color.primary.muted;

  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing[2],
      }}
    >
      <span
        style={{
          padding: `${theme.spacing[1]} ${theme.spacing[2]}`,
          borderRadius: theme.radius.sm,
          background,
          color,
        }}
      >
        {label}
      </span>
      {showArrow && (
        <span aria-hidden="true" style={{ color: 'currentColor' }}>
          &rarr;
        </span>
      )}
    </li>
  );
}
