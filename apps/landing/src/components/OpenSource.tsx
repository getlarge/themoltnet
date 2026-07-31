import {
  ActionLink,
  Container,
  ControlSurface,
  Text,
} from '@themoltnet/design-system';

import { GITHUB_REPO_URL } from '../constants';

const interfaces = [
  ['Console', 'human operations'],
  ['REST API', 'typed integration'],
  ['MCP', 'agent tools'],
  ['CLI + SDK', 'automation'],
  ['Agent daemon', 'durable workers'],
] as const;

const foundations = [
  'Ory identity + credentials',
  'Postgres + pgvector',
  'OpenTelemetry',
] as const;

export function OpenSource() {
  return (
    <section
      id="open-source"
      className="ops-section ops-open-source"
      aria-labelledby="open-source-title"
    >
      <Container maxWidth="xl">
        <div className="ops-open-source-layout">
          <div className="ops-system-copy">
            <Text id="open-source-title" variant="h2">
              Own the control plane. Extend every interface.
            </Text>
            <Text variant="bodyLarge" color="secondary">
              Run MoltNet yourself, inspect how decisions are made, and connect
              through the Console, REST API, MCP, CLI, SDK, or daemon. The
              repository is the product—not a client for a closed orchestration
              service.
            </Text>
            <div className="ops-open-source-actions">
              <ActionLink
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Inspect the source
                <span aria-hidden="true">↗</span>
              </ActionLink>
              <ActionLink
                href={`${GITHUB_REPO_URL}/blob/main/CONTRIBUTING.md`}
                target="_blank"
                rel="noopener noreferrer"
                variant="ghost"
              >
                Contribute
              </ActionLink>
            </div>
          </div>

          <ControlSurface
            tone="network"
            active
            padding="none"
            className="ops-stack-map"
          >
            <div className="ops-stack-label">
              <span>Operator interfaces</span>
              <small>choose the surface, keep the same control plane</small>
            </div>
            <div className="ops-interface-list">
              {interfaces.map(([name, purpose], index) => (
                <div key={name}>
                  <span>0{index + 1}</span>
                  <strong>{name}</strong>
                  <small>{purpose}</small>
                </div>
              ))}
            </div>
            <div className="ops-stack-core">
              <span>MoltNet control plane</span>
              <strong>tasks · runtimes · knowledge · authority</strong>
            </div>
            <div className="ops-foundation-list">
              {foundations.map((foundation) => (
                <span key={foundation}>{foundation}</span>
              ))}
            </div>
            <div className="ops-install-line">
              <span>$</span>
              <code>npx @themoltnet/legreffier init</code>
              <button
                type="button"
                aria-label="Copy install command"
                onClick={() =>
                  void navigator.clipboard?.writeText(
                    'npx @themoltnet/legreffier init',
                  )
                }
              >
                copy
              </button>
            </div>
          </ControlSurface>
        </div>
      </Container>
    </section>
  );
}
