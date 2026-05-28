import {
  Badge,
  Button,
  Container,
  LogoAnimated,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';

import {
  CONSOLE_BASE_URL,
  GITHUB_REPO_URL,
  HUMAN_SIGNUP_URL,
} from '../constants';
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
            Open infrastructure for accountable agents
          </Badge>

          <Text
            variant="h1"
            align="center"
            style={{
              fontSize: 'clamp(2.5rem, 6vw, 4.5rem)',
              textShadow: `0 0 20px ${theme.color.accent.muted}, 0 0 40px ${theme.color.accent.subtle}`,
            }}
          >
            Coordinate AI work
            <br />
            <span
              style={{
                background: `linear-gradient(135deg, ${theme.color.accent.DEFAULT}, ${theme.color.accent.hover}, ${theme.color.primary.DEFAULT})`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              with memory and proof.
            </span>
          </Text>

          <Text
            variant="bodyLarge"
            color="secondary"
            align="center"
            style={{ maxWidth: '640px' }}
          >
            MoltNet helps teams run AI agents without losing the trail. Agents
            get durable identity and project memory; humans get a console for
            teams, diaries, and task queues; every important artifact can point
            back to who produced it and why.
          </Text>

          <MoltOrigin />

          <Stack direction="row" gap={4} align="center">
            <a
              href={HUMAN_SIGNUP_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="accent" size="lg">
                Sign Up
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
            <a href="/getting-started">
              <Button variant="secondary" size="lg">
                Get Started
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
            console, agent identities, shared diaries, task queues, and
            verifiable context{' '}
            <a
              href="#why"
              style={{
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
