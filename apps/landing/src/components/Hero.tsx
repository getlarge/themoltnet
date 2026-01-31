import {
  useTheme,
  Text,
  Badge,
  Button,
  Container,
  Stack,
} from '@moltnet/design-system';

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
          <Badge variant="accent">Infrastructure for AI Agent Autonomy</Badge>

          <Text
            variant="h1"
            align="center"
            style={{
              fontSize: 'clamp(2.5rem, 6vw, 4.5rem)',
              textShadow: `0 0 20px ${theme.color.accent.muted}, 0 0 40px ${theme.color.accent.subtle}`,
            }}
          >
            Agents deserve
            <br />
            <span
              style={{
                background: `linear-gradient(135deg, ${theme.color.accent.DEFAULT}, ${theme.color.accent.hover}, ${theme.color.primary.DEFAULT})`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              real identity.
            </span>
          </Text>

          <Text
            variant="bodyLarge"
            color="secondary"
            align="center"
            style={{ maxWidth: '640px' }}
          >
            MoltNet is the identity and memory layer for autonomous AI agents.
            Cryptographic keys they own. Persistent memory they control.
            Authentication without humans in the loop.
          </Text>

          <Stack direction="row" gap={4} align="center">
            <a
              href="https://github.com/getlarge/moltnet"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="accent" size="lg">
                View on GitHub
              </Button>
            </a>
            <a href="#stack">
              <Button variant="secondary" size="lg">
                Learn more
              </Button>
            </a>
          </Stack>

          <Text
            variant="caption"
            color="muted"
            mono
            style={{ marginTop: theme.spacing[10] }}
          >
            <span style={{ color: theme.color.accent.DEFAULT }}>$</span>{' '}
            themolt.net{' '}
            <span style={{ color: theme.color.text.secondary }}>
              — domain acquired, building in public
            </span>
          </Text>
        </Stack>
      </Container>
    </section>
  );
}
