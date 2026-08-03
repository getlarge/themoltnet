import {
  ActionLink,
  Badge,
  Container,
  ControlSurface,
  Logo,
  Stack,
  Text,
} from '@themoltnet/design-system';

import { getConfig } from '../config';
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

export function Hero() {
  const { docsUrl } = getConfig();

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
              variant="h1"
              className="ops-display"
              style={{ maxWidth: '12.5ch' }}
            >
              Agents need autonomy—not your authority.
            </Text>

            <Text
              variant="bodyLarge"
              color="secondary"
              style={{ maxWidth: '58ch' }}
            >
              MoltNet dispatches typed work, enforces runtime policy, and turns
              attributed outcomes into knowledge you own and can carry between
              runtimes—under one identity and authorization model.
            </Text>

            <Stack direction="row" gap={3} wrap>
              <ActionLink href="/getting-started" size="lg">
                Run a supervised pilot
                <span aria-hidden="true">→</span>
              </ActionLink>
              <ActionLink
                href={`${docsUrl}/understand/architecture`}
                target="_blank"
                rel="noopener noreferrer"
                variant="secondary"
                size="lg"
              >
                Inspect the architecture
              </ActionLink>
            </Stack>

            <div className="ops-hero-proof" aria-label="Project properties">
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                <strong>Open source</strong>
                <span>deploy or inspect</span>
              </a>
              <div>
                <strong>Policy-bound</strong>
                <span>per task and runtime</span>
              </div>
              <div>
                <strong>Attributable</strong>
                <span>from claim to evidence</span>
              </div>
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
                      <span aria-hidden="true">0{index + 1}</span>
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
                      Inspect system <span aria-hidden="true">↗</span>
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

        <a className="ops-scroll-cue" href="#execution-trace">
          Follow one task through the system
          <span aria-hidden="true">↓</span>
        </a>
      </Container>
    </section>
  );
}
