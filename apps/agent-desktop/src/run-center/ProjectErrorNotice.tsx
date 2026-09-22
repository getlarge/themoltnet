import { Button, InlineNotice } from '@themoltnet/design-system';

import type { AgentServerCatalogue } from './types.js';

export type ProjectError = AgentServerCatalogue['projectErrors'][number];

/** Truncation still lists projects; every other code leaves them unknown. */
export function projectErrorBlocks(error: ProjectError | undefined): boolean {
  return Boolean(error && error.code !== 'truncated');
}

/**
 * Discovery problems differ in what helps: a partial list needs no action,
 * missing access needs a renewed credential, and only a transport or server
 * failure is worth retrying.
 */
export function ProjectErrorNotice({
  error,
  onRetry,
  onTeams,
}: {
  error: ProjectError;
  onRetry: () => void;
  onTeams?: () => void;
}) {
  if (error.code === 'truncated')
    return (
      <InlineNotice tone="info" title="Some projects are not listed">
        {error.message}
      </InlineNotice>
    );
  if (error.code === 'forbidden')
    return (
      <InlineNotice tone="error" title="Project access needed">
        {error.message}
        {onTeams ? (
          <Button variant="secondary" onClick={onTeams}>
            Identity and teams
          </Button>
        ) : null}
      </InlineNotice>
    );
  return (
    <InlineNotice tone="warning" title="Project discovery unavailable">
      {error.message}
      <Button variant="secondary" onClick={onRetry}>
        Retry discovery
      </Button>
    </InlineNotice>
  );
}
