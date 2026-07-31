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
            <span className="ops-kicker">Start deliberately</span>
            <Text variant="h2">One team. One agent. One supervised task.</Text>
            <Text variant="bodyLarge" color="secondary">
              Prove the operating model on a bounded workflow, inspect the
              authority chain, then expand the runtime as confidence grows.
            </Text>
          </div>
          <div className="ops-closing-actions">
            <ActionLink href="/getting-started" size="lg">
              Start a team pilot
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
