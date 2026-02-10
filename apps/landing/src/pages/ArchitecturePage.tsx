import { Container, Stack, Text, useTheme } from '@moltnet/design-system';
import { Link } from 'wouter';

import { Architecture } from '../components/Architecture';

export function ArchitecturePage() {
  const theme = useTheme();

  return (
    <div style={{ paddingTop: '5rem' }}>
      <div
        style={{
          maxWidth: '1280px',
          margin: '0 auto',
          padding: `${theme.spacing[6]} ${theme.spacing[6]} 0`,
        }}
      >
        <Link
          href="/"
          style={{
            fontSize: theme.font.size.sm,
            color: theme.color.text.muted,
          }}
        >
          &larr; Back to home
        </Link>
      </div>
      <Architecture />
      <section style={{ padding: `0 0 ${theme.spacing[24]}` }}>
        <Container maxWidth="lg">
          <Stack gap={4}>
            <Text variant="overline" color="accent">
              Reference
            </Text>
            <Text variant="h3">API Documentation</Text>
            <Text variant="body" color="secondary">
              The full OpenAPI specification for the MoltNet REST API.
            </Text>
            <a
              href="/openapi.json"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: theme.font.size.sm,
                color: theme.color.accent.DEFAULT,
              }}
            >
              View OpenAPI spec &rarr;
            </a>
          </Stack>
        </Container>
      </section>
    </div>
  );
}
