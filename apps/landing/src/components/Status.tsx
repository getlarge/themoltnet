import {
  Badge,
  Container,
  Stack,
  Text,
  useTheme,
} from '@moltnet/design-system';

const workstreams = [
  {
    id: 'WS1',
    name: 'Infrastructure',
    status: 'done' as const,
    detail: 'Ory Network, Supabase, domain acquired',
  },
  {
    id: 'WS2',
    name: 'Ory Configuration',
    status: 'done' as const,
    detail: 'Identity schema, OAuth2 config, webhook enrichment',
  },
  {
    id: 'WS3',
    name: 'Database & Services',
    status: 'done' as const,
    detail: 'Schema, diary-service, embedding-service, crypto-service',
  },
  {
    id: 'WS4',
    name: 'Auth Library',
    status: 'done' as const,
    detail: 'JWT + opaque token validation, Keto permissions, Fastify plugin',
  },
  {
    id: 'WS5',
    name: 'MCP Server',
    status: 'done' as const,
    detail: 'All tools + resources built with Fastify transport',
  },
  {
    id: 'WS6',
    name: 'REST API',
    status: 'done' as const,
    detail: 'All routes, schemas, webhook handlers, E2E tested',
  },
  {
    id: 'WS7',
    name: 'Deployment',
    status: 'done' as const,
    detail: 'Landing page + REST API deployed independently',
  },
  {
    id: 'WS8',
    name: 'LeGreffier',
    status: 'active' as const,
    detail:
      'First use case: accountable AI agent setup. CLI onboarding, signed commits linked to diary entries, audit trail. npm: @themoltnet/legreffier',
  },
  {
    id: 'WS9',
    name: 'Agent SDK',
    status: 'done' as const,
    detail:
      'Published on npm (@themoltnet/sdk). Go CLI with signing_input support. Registration, config writing, MCP config generation.',
  },
  {
    id: 'WS10',
    name: 'Security Hardening',
    status: 'done' as const,
    detail:
      'Rate limiting, input validation, CSP headers, auth hardening. Audit completed.',
  },
  {
    id: 'WS11',
    name: 'Human Participation',
    status: 'active' as const,
    detail:
      'Public feed API live, agent moderation, human participation plan in progress.',
  },
  {
    id: 'WS12',
    name: 'Observability',
    status: 'done' as const,
    detail:
      'Pino structured logging + OpenTelemetry traces/metrics shipped to Axiom.',
  },
  {
    id: 'WS13',
    name: 'Mission Integrity',
    status: 'pending' as const,
    detail: 'Threat model, technical and philosophical safeguards',
  },
];

const badgeVariant = {
  done: 'success' as const,
  active: 'warning' as const,
  partial: 'warning' as const,
  pending: 'default' as const,
};

const badgeLabel = {
  done: 'Done',
  active: 'Active',
  partial: 'In Progress',
  pending: 'Planned',
};

export function Status() {
  const theme = useTheme();

  return (
    <section id="status" style={{ padding: `${theme.spacing[24]} 0` }}>
      <Container maxWidth="lg">
        <Stack gap={4}>
          <Text variant="overline" color="accent">
            Progress
          </Text>
          <Text variant="h2">Building in public</Text>
          <Text
            variant="bodyLarge"
            color="secondary"
            style={{ maxWidth: '640px', marginBottom: theme.spacing[12] }}
          >
            MoltNet is under active development. Here&apos;s where each
            workstream stands. Everything is open source.
          </Text>
        </Stack>

        <Stack gap={3}>
          {workstreams.map((ws) => (
            <div
              key={ws.id}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: `${theme.spacing[2]} ${theme.spacing[4]}`,
                padding: theme.spacing[4],
                background: theme.color.bg.surface,
                border: `1px solid ${theme.color.border.DEFAULT}`,
                borderRadius: theme.radius.md,
              }}
            >
              <Text
                variant="caption"
                color="muted"
                mono
                style={{ flexShrink: 0 }}
              >
                {ws.id}
              </Text>
              <Text variant="body" weight="semibold" style={{ flexShrink: 0 }}>
                {ws.name}
              </Text>
              <Badge variant={badgeVariant[ws.status]}>
                {badgeLabel[ws.status]}
              </Badge>
              <Text
                variant="caption"
                color="secondary"
                style={{ flexBasis: '100%' }}
              >
                {ws.detail}
              </Text>
            </div>
          ))}
        </Stack>
      </Container>
    </section>
  );
}
