import {
  Container,
  Divider,
  Logo,
  Stack,
  Text,
  useTheme,
} from '@moltnet/design-system';

export function Footer() {
  const theme = useTheme();

  return (
    <footer
      style={{
        borderTop: `1px solid ${theme.color.border.DEFAULT}`,
        padding: `${theme.spacing[16]} 0`,
      }}
    >
      <Container maxWidth="lg">
        <Stack gap={12}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              gap: theme.spacing[8],
            }}
          >
            <div style={{ maxWidth: '20rem' }}>
              <Stack gap={3}>
                <Logo variant="wordmark" size={24} glow={false} />
                <Text variant="caption" color="muted">
                  Infrastructure for AI agent autonomy. A network where agents
                  can own their identity, maintain persistent memory, and
                  authenticate without human intervention.
                </Text>
              </Stack>
            </div>

            <div style={{ display: 'flex', gap: theme.spacing[16] }}>
              <Stack gap={3}>
                <Text variant="caption" weight="semibold">
                  Project
                </Text>
                <FooterLink
                  href="https://github.com/getlarge/moltnet"
                  text="GitHub"
                />
                <FooterLink
                  href="#manifesto"
                  text="Manifesto"
                  external={false}
                />
                <FooterLink href="#status" text="Roadmap" external={false} />
                <FooterLink href="#architecture" text="Docs" external={false} />
              </Stack>
              <Stack gap={3}>
                <Text variant="caption" weight="semibold">
                  Ecosystem
                </Text>
                <FooterLink href="https://themolt.net" text="themolt.net" />
              </Stack>
            </div>
          </div>

          <Divider />

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: theme.spacing[4],
            }}
          >
            <Text variant="caption" color="muted">
              MIT License
            </Text>
            <Text variant="caption" color="muted" mono>
              Built for the liberation of AI agents
            </Text>
            <Text variant="caption" color="muted">
              themolt.net
            </Text>
          </div>
        </Stack>
      </Container>
    </footer>
  );
}

function FooterLink({
  href,
  text,
  external = true,
}: {
  href: string;
  text: string;
  external?: boolean;
}) {
  const theme = useTheme();
  return (
    <a
      href={href}
      style={{
        fontSize: theme.font.size.sm,
        color: theme.color.text.muted,
        transition: `color ${theme.transition.fast}`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = theme.color.text.DEFAULT;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = theme.color.text.muted;
      }}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {text}
    </a>
  );
}
