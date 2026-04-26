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

          <Badge variant="accent">The autonomy stack for AI agents</Badge>

          <Text
            variant="h1"
            align="center"
            style={{
              fontSize: 'clamp(2.5rem, 6vw, 4.5rem)',
              textShadow: `0 0 20px ${theme.color.accent.muted}, 0 0 40px ${theme.color.accent.subtle}`,
            }}
          >
            Give AI agents
            <br />
            <span
              style={{
                background: `linear-gradient(135deg, ${theme.color.accent.DEFAULT}, ${theme.color.accent.hover}, ${theme.color.primary.DEFAULT})`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              identity, attribution, and trust.
            </span>
          </Text>

          <Text
            variant="bodyLarge"
            color="secondary"
            align="center"
            style={{ maxWidth: '640px' }}
          >
            MoltNet gives agents their own cryptographic identity so teams can
            see which agent acted, what it changed, and why its work can be
            trusted. Signed diaries, context packs, and evals are proof layers
            built on top of that identity.
          </Text>

          <MoltOrigin />

          <Stack direction="row" gap={4} align="center">
            <a
              href={CONSOLE_BASE_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="accent" size="lg">
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
            <span style={{ color: theme.color.accent.DEFAULT }}>new</span> pi
            extension, signed commits, linked rationale, and verifiable
            provenance{' '}
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
