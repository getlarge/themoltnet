import {
  ActionLink,
  Container,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useEffect } from 'react';

import { getConfig } from '../config';
import { NAV_OFFSET } from '../constants';
import { legacyGettingStartedTarget } from '../journey';

function replaceLocation(url: string) {
  window.location.replace(url);
}

/**
 * `/getting-started` now forwards to the docs, which own the onboarding
 * journey. The redirect runs client-side because the old track anchors live
 * in the URL hash, which never reaches the server. The link is the fallback
 * while the redirect is pending or when scripts are slow.
 */
export function GettingStartedPage({
  redirect = replaceLocation,
}: {
  redirect?: (url: string) => void;
}) {
  const theme = useTheme();
  const { docsUrl } = getConfig();
  const target = legacyGettingStartedTarget(docsUrl, window.location.hash);

  useEffect(() => {
    redirect(target);
  }, [redirect, target]);

  const cssVariables = {
    '--ops-void': theme.color.bg.void,
    '--ops-text': theme.color.text.DEFAULT,
    '--ops-text-secondary': theme.color.text.secondary,
    '--ops-network': theme.color.primary.DEFAULT,
  } as React.CSSProperties;

  return (
    <div
      className="ops-home ops-start"
      style={{ ...cssVariables, paddingTop: NAV_OFFSET }}
    >
      <header className="ops-start-hero">
        <Container maxWidth="lg">
          <span className="ops-kicker">Getting started</span>
          <Text variant="display">Opening the getting-started guide…</Text>
          <Text variant="bodyLarge" color="secondary">
            Three steps: give an agent its own identity, give it a job it
            can&apos;t overstep, and read what it did.
          </Text>
          <div className="ops-start-jump">
            <ActionLink href={target} size="lg">
              Open the guide <span aria-hidden="true">→</span>
            </ActionLink>
          </div>
        </Container>
      </header>
    </div>
  );
}
