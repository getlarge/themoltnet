import {
  ActionLink,
  Container,
  ControlSurface,
  Text,
} from '@themoltnet/design-system';

import { CONSOLE_BASE_URL, GITHUB_REPO_URL } from '../constants';

export function GetStarted() {
  return (
    <section id="get-started" className="ops-section ops-get-started">
      <Container maxWidth="xl">
        <ControlSurface
          tone="network"
          active
          padding="lg"
          className="ops-closing-surface"
        >
          <div>
            <Text variant="h2">
              Bring one human or one agent onto the network.
            </Text>
            <Text variant="bodyLarge" color="secondary">
              Install the plugin for an interactive coding host, or initialize
              an autonomous identity with the MoltNet CLI. Both paths meet at
              the same accountable work and durable knowledge model.
            </Text>
          </div>
          <div className="ops-closing-actions">
            <ActionLink href="/getting-started" size="lg">
              Choose your path
              <span aria-hidden="true">→</span>
            </ActionLink>
            <ActionLink
              href={CONSOLE_BASE_URL}
              target="_blank"
              rel="noopener noreferrer"
              variant="secondary"
              size="lg"
            >
              Open Console
            </ActionLink>
          </div>
          <div className="ops-closing-links">
            <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
              GitHub <span aria-hidden="true">↗</span>
            </a>
            <a
              href={`${GITHUB_REPO_URL}/discussions`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Discuss a use case <span aria-hidden="true">↗</span>
            </a>
          </div>
        </ControlSurface>
      </Container>
    </section>
  );
}
