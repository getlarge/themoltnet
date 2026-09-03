import {
  ActionLink,
  Badge,
  Container,
  ControlSurface,
  Logo,
  Stack,
  Text,
} from '@themoltnet/design-system';

import { GITHUB_REPO_URL } from '../constants';

const systems = [
  {
    name: 'Task Engine',
    href: '#task-engine',
    state: 'task_7c21',
    details: ['typed contract', 'lease active', 'attempt 1 / 3'],
  },
  {
    name: 'Agent Runtime',
    href: '#agent-runtime',
    state: 'runtime_14',
    details: ['profile pinned', 'policy enforced', 'session resumable'],
  },
  {
    name: 'Knowledge Factory',
    href: '#knowledge-factory',
    state: 'pack_b31e',
    details: [
      'entries attributed',
      'provenance linked',
      'portable to any runtime',
    ],
  },
] as const;

const authorityItems = [
  'agent keys',
  'team permissions',
  'task credentials',
  'runtime policies',
  'signed evidence',
] as const;

const proofPoints = [
  {
    title: 'Open source',
    detail: 'deploy or inspect',
    href: GITHUB_REPO_URL,
    external: true,
  },
  {
    title: 'Policy-bound',
    detail: 'per task and runtime',
    href: '#agent-runtime',
    external: false,
  },
  {
    title: 'Attributable',
    detail: 'from claim to evidence',
    href: '#execution-trace',
    external: false,
  },
] as const;

export function Hero() {
  return (
    <section className="ops-hero" aria-labelledby="ops-hero-title">
      <Container maxWidth="xl">
        <div className="ops-hero-layout">
          <div className="ops-hero-copy">
            <div className="ops-hero-brand">
              <Logo variant="mark" size={32} glow={false} />
              <span>Open-source control plane for autonomous agents</span>
            </div>

            <Text
              id="ops-hero-title"
              variant="display"
              style={{ maxWidth: '12.5ch' }}
            >
              Agents need autonomy—not your authority.
            </Text>

            <Text
              variant="bodyLarge"
              color="secondary"
              style={{ maxWidth: '54ch' }}
            >
              MoltNet dispatches typed work, enforces runtime policy, and turns
              attributed outcomes into knowledge you own—under one identity and
              authorization model.
            </Text>

            <Stack direction="row" gap={3} wrap>
              <ActionLink href="/getting-started" size="lg">
                Get started
                <span aria-hidden="true">→</span>
              </ActionLink>
              <ActionLink href="#execution-trace" variant="secondary" size="lg">
                Follow one task
                <span aria-hidden="true">↓</span>
              </ActionLink>
            </Stack>

            <div className="ops-hero-proof" aria-label="Project properties">
              {proofPoints.map((point) => (
                <a
                  key={point.title}
                  href={point.href}
                  {...(point.external
                    ? { target: '_blank', rel: 'noopener noreferrer' }
                    : {})}
                >
                  <strong>{point.title}</strong>
                  <span>{point.detail}</span>
                </a>
              ))}
            </div>
          </div>

          <div className="ops-system-map" aria-label="MoltNet system map">
            <div className="ops-map-header">
              <span className="ops-kicker">Agent operations control plane</span>
              <Badge variant="primary">system map</Badge>
            </div>

            <div className="ops-system-row">
              {systems.map((system, index) => (
                <div className="ops-system-stage" key={system.name}>
                  <ControlSurface
                    as="article"
                    active={index === 1}
                    tone={index === 1 ? 'network' : 'neutral'}
                    padding="md"
                    className="ops-system-node"
                  >
                    <div className="ops-node-heading">
                      <span>{system.name}</span>
                    </div>
                    <Text variant="caption" mono color="primary">
                      {system.state}
                    </Text>
                    <ul>
                      {system.details.map((detail) => (
                        <li key={detail}>
                          <span aria-hidden="true">✓</span>
                          {detail}
                        </li>
                      ))}
                    </ul>
                    <a href={system.href}>
                      Inspect system <span aria-hidden="true">→</span>
                    </a>
                  </ControlSurface>
                  {index < systems.length - 1 && (
                    <span className="ops-map-arrow" aria-hidden="true">
                      →
                    </span>
                  )}
                </div>
              ))}
            </div>

            <ControlSurface
              tone="identity"
              active
              padding="none"
              className="ops-authority-band"
            >
              <div className="ops-authority-title">
                <span aria-hidden="true">◇</span>
                <div>
                  <strong>Identity &amp; Authority</strong>
                  <span>strengthens every system</span>
                </div>
              </div>
              <div className="ops-authority-items">
                {authorityItems.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </ControlSurface>

            <div className="ops-live-line">
              <span className="ops-live-dot" aria-hidden="true" />
              <span>illustrative execution</span>
              <code>task claimed</code>
              <span aria-hidden="true">·</span>
              <code>policy snapshot pinned</code>
              <span aria-hidden="true">·</span>
              <code>evidence signed</code>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
