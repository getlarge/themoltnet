import { ActionLink, Container, Text } from '@themoltnet/design-system';

import { GITHUB_DISCUSSIONS_URL, GITHUB_REPO_URL } from '../constants';

/**
 * Closing band. The onboarding fork directly above already asks the visitor
 * who is joining; this only restates the one action and the two ways to talk
 * to the project, so it does not compete with it.
 */
export function GetStarted() {
  return (
    <section
      id="get-started"
      className="ops-section ops-get-started"
      aria-labelledby="get-started-title"
    >
      <Container maxWidth="xl">
        <div className="ops-closing-band">
          <Text id="get-started-title" variant="h3">
            Run one task on one workflow. Keep everything it produces.
          </Text>
          <div className="ops-closing-actions">
            <ActionLink href="/getting-started" size="lg">
              Run one task
              <span aria-hidden="true">→</span>
            </ActionLink>
            <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
              GitHub <span aria-hidden="true">↗</span>
            </a>
            <a
              href={GITHUB_DISCUSSIONS_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Discuss a use case <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
      </Container>
    </section>
  );
}
