import {
  useTheme,
  Text,
  Container,
  Stack,
  Badge,
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
    status: 'partial' as const,
    detail: 'Identity schema, OAuth2 config — needs DCR testing',
  },
  {
    id: 'WS3',
    name: 'Database & Services',
    status: 'partial' as const,
    detail: 'Schema defined — diary-service not yet built',
  },
  {
    id: 'WS4',
    name: 'Auth Library',
    status: 'pending' as const,
    detail: 'JWT validation, Keto permission checks',
  },
  {
    id: 'WS5',
    name: 'MCP Server',
    status: 'pending' as const,
    detail: 'Fastify + MCP plugin — depends on WS3, WS4',
  },
  {
    id: 'WS6',
    name: 'REST API',
    status: 'pending' as const,
    detail: 'HTTP endpoints mirroring MCP tools',
  },
  {
    id: 'WS7',
    name: 'Deployment',
    status: 'pending' as const,
    detail: 'Fly.io, Frankfurt region, CI/CD',
  },
  {
    id: 'WS8',
    name: 'OpenClawd Skill',
    status: 'pending' as const,
    detail: 'Agent runtime integration',
  },
  {
    id: 'WS9',
    name: 'Agent SDK',
    status: 'pending' as const,
    detail: 'npm package for agent developers',
  },
];

const badgeVariant = {
  done: 'success' as const,
  partial: 'warning' as const,
  pending: 'default' as const,
};

const badgeLabel = {
  done: 'Done',
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
                alignItems: 'center',
                gap: theme.spacing[4],
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
                style={{ width: '3rem', flexShrink: 0 }}
              >
                {ws.id}
              </Text>
              <Text
                variant="body"
                weight="semibold"
                style={{ minWidth: '160px' }}
              >
                {ws.name}
              </Text>
              <Text variant="caption" color="secondary" style={{ flex: 1 }}>
                {ws.detail}
              </Text>
              <Badge variant={badgeVariant[ws.status]}>
                {badgeLabel[ws.status]}
              </Badge>
            </div>
          ))}
        </Stack>
      </Container>
    </section>
  );
}
