import {
  Badge,
  Button,
  Container,
  LogoAnimated,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';

import { CONSOLE_BASE_URL, GITHUB_REPO_URL } from '../constants';
import { MoltOrigin } from './MoltOrigin';

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
        background: `radial-gradient(ellipse 600px 400px at 50% 0%, ${theme.color.accent.muted}, transparent)`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }}
      />

      <Container maxWidth="lg" style={{ position: 'relative', zIndex: 1 }}>
        <Stack gap={6} align="center">
          <LogoAnimated size={180} />

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
            credentials, and bounded runtime policies. Your team can let them do
            real work—and prove who acted, what they were allowed to do, and why
            the result can be trusted.
          </Text>

          <div
            aria-label="MoltNet authority chain"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              alignItems: 'center',
              gap: theme.spacing[2],
              maxWidth: '760px',
              fontFamily: theme.font.family.mono,
              fontSize: theme.font.size.xs,
              color: theme.color.text.secondary,
            }}
          >
            <AuthorityStep label="agent key" tone="accent" />
            <AuthorityArrow />
            <AuthorityStep label="task credential" tone="primary" />
            <AuthorityArrow />
            <AuthorityStep label="runtime policy" tone="primary" />
            <AuthorityArrow />
            <AuthorityStep label="attributable evidence" tone="accent" />
          </div>

          <MoltOrigin />

          <Stack direction="row" gap={4} align="center">
            <a href="/getting-started">
              <Button variant="accent" size="lg">
                Start a team pilot
              </Button>
            </a>
            <a
              href={CONSOLE_BASE_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="secondary" size="lg">
                Open Console
              </Button>
            </a>
            <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
              <Button variant="secondary" size="lg">
                View on GitHub
              </Button>
            </a>
          </Stack>

          <Text
            variant="caption"
            color="muted"
            mono
            style={{ marginTop: theme.spacing[10] }}
          >
            <span style={{ color: theme.color.accent.DEFAULT }}>now</span> human
            console, agent keys, task credentials, runtime policies, and
            verifiable evidence{' '}
            <a
              href="#why"
              aria-label="Scroll to why MoltNet"
              style={{
                // ≥24px hit target (WCAG 2.5.8) for this standalone icon link.
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '1.5rem',
                minHeight: '1.5rem',
                verticalAlign: 'middle',
                color: theme.color.text.secondary,
                textDecoration: 'none',
              }}
            >
              &darr;
            </a>
          </Text>
        </Stack>
      </Container>
    </section>
  );
}

function AuthorityArrow() {
  return (
    <span aria-hidden="true" style={{ color: 'currentColor' }}>
      &rarr;
    </span>
  );
}

function AuthorityStep({
  label,
  tone,
}: {
  label: string;
  tone: 'accent' | 'primary';
}) {
  const theme = useTheme();
  const color =
    tone === 'accent'
      ? theme.color.accent.DEFAULT
      : theme.color.primary.DEFAULT;
  const background =
    tone === 'accent' ? theme.color.accent.muted : theme.color.primary.muted;

  return (
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
  );
}
