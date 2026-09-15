/**
 * The onboarding journey lives in the docs (`docs/start`). The landing page
 * only links into it, so these paths are the one place it names docs pages.
 */
export const DOCS_HUB_PATH = '/start/getting-started';
export const DOCS_AGENT_IDENTITY_PATH = '/start/agent-identity';
export const DOCS_CODING_AGENT_PATH =
  '/start/install-and-initialize#install-legreffier';

/**
 * The retired `/getting-started` page had one track per job, addressed by
 * hash. Old links keep landing on the closest docs page.
 */
const LEGACY_TRACK_PATHS: Readonly<Record<string, string>> = {
  review: DOCS_HUB_PATH,
  embed: DOCS_HUB_PATH,
  code: DOCS_CODING_AGENT_PATH,
  agent: DOCS_AGENT_IDENTITY_PATH,
};

export function docsHref(docsUrl: string, path: string): string {
  return `${docsUrl.replace(/\/$/, '')}${path}`;
}

export function legacyGettingStartedTarget(
  docsUrl: string,
  hash: string,
): string {
  const track = hash.replace(/^#/, '');
  return docsHref(docsUrl, LEGACY_TRACK_PATHS[track] ?? DOCS_HUB_PATH);
}
