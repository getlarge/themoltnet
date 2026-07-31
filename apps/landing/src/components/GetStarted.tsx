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
              Start with one team, one agent, one supervised task.
            </Text>
            <Text variant="bodyLarge" color="secondary">
              Use a bounded workflow to inspect the full chain—from task permit
              to runtime policy to signed evidence. Expand only when the
              operating model earns your trust.
            </Text>
          </div>
          <div className="ops-closing-actions">
            <ActionLink href="/getting-started" size="lg">
              Run a supervised pilot
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
