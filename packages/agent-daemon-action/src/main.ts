/**
 * Bundled entrypoint executed by the composite action.
 *
 * Reads the GitHub event payload from $GITHUB_EVENT_PATH, builds an Octokit
 * with $GITHUB_TOKEN, calls dispatch(). All MoltNet-side env vars
 * (MOLTNET_API_URL, MOLTNET_AGENT_TOKEN, MOLTNET_TEAM_ID, MOLTNET_DIARY_ID)
 * are passed through by action.yml.
 */
import { readFileSync } from 'node:fs';

import * as core from '@actions/core';
import { getOctokit } from '@actions/github';

import { dispatch } from './dispatch.js';

async function main(): Promise<void> {
  const eventPath = process.env['GITHUB_EVENT_PATH'];
  const ghToken = process.env['GITHUB_TOKEN'];
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH not set');
  if (!ghToken) throw new Error('GITHUB_TOKEN not set');

  const payload = JSON.parse(readFileSync(eventPath, 'utf8')) as Record<
    string,
    unknown
  >;

  const github = getOctokit(ghToken);

  await dispatch({
    github,
    context: {
      payload: payload as Parameters<typeof dispatch>[0]['context']['payload'],
    } as Parameters<typeof dispatch>[0]['context'],
    env: process.env,
  });
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  core.setFailed(msg);
});
