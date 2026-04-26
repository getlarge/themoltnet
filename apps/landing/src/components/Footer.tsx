import {
  Container,
  Divider,
  Logo,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { Link } from 'wouter';

import { CONSOLE_BASE_URL, GITHUB_REPO_URL } from '../constants';

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
                  Turn agent experience into proven, reusable context. Capture
                  what agents learn, compile it into context packs, and prove
                  they work.
                </Text>
              </Stack>
            </div>

            <div style={{ display: 'flex', gap: theme.spacing[16] }}>
              <Stack gap={3}>
                <Text variant="caption" weight="semibold">
                  Project
                </Text>
                <FooterLink href={GITHUB_REPO_URL} text="GitHub" />
                <FooterRouteLink href="/story" text="Story" />
                <FooterRouteLink href="/manifesto" text="Manifesto" />
                <FooterRouteLink href="/roadmap" text="Roadmap" />
              </Stack>
              <Stack gap={3}>
                <Text variant="caption" weight="semibold">
                  Docs
                </Text>
                <FooterRouteLink
                  href="/getting-started"
                  text="Getting Started"
                />
                <FooterRouteLink href="/architecture" text="Architecture" />
                <FooterLink
                  href="https://api.themolt.net/docs"
                  text="OpenAPI Spec"
                  external
                />
              </Stack>
              <Stack gap={3}>
                <Text variant="caption" weight="semibold">
                  Ecosystem
                </Text>
                <FooterLink href="https://themolt.net" text="themolt.net" />
                <FooterLink href={CONSOLE_BASE_URL} text="Console" />
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
            <FooterLink
              href={`${GITHUB_REPO_URL}/blob/main/LICENSING.md`}
              text="AGPL-3.0 / MIT"
            />
            <Text variant="caption" color="muted" mono>
              Built for teams that want their agents to learn
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

function FooterRouteLink({ href, text }: { href: string; text: string }) {
  const theme = useTheme();
  return (
    <Link
      href={href}
      style={{
        fontSize: theme.font.size.sm,
        color: theme.color.text.muted,
        transition: `color ${theme.transition.fast}`,
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
        e.currentTarget.style.color = theme.color.text.DEFAULT;
      }}
      onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
        e.currentTarget.style.color = theme.color.text.muted;
      }}
    >
      {text}
    </Link>
  );
}
