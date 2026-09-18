#!/usr/bin/env node

import { Configuration, WorkspaceApi } from '@ory/client-fetch';
import { pathToFileURL } from 'node:url';

function fail(message) {
  throw new Error(message);
}

export function resolveProjectTarget({
  projects,
  projectUrl,
  expectedProject,
}) {
  const url = new URL(projectUrl);
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.projects.oryapis.com')
  ) {
    fail('The restore target must be a direct HTTPS Ory project URL.');
  }

  const slug = url.hostname.slice(0, -'.projects.oryapis.com'.length);
  if (!slug || slug.includes('.')) {
    fail('The direct Ory project URL does not contain one project slug.');
  }

  const items = Array.isArray(projects)
    ? projects
    : (projects?.projects ?? projects?.items ?? projects?.data);
  if (!Array.isArray(items)) {
    fail('Ory project inventory must be an array or a projects array.');
  }

  const matches = items.filter((project) => project?.slug === slug);
  if (matches.length !== 1 || typeof matches[0]?.id !== 'string') {
    fail(
      `Expected one workspace project for slug ${slug}, found ${matches.length}.`,
    );
  }

  const resolvedProject = matches[0].id;
  if (resolvedProject !== expectedProject) {
    fail(
      'The independently resolved project ID does not match the protected environment.',
    );
  }

  return resolvedProject;
}

export async function resolveProjectTargetFromWorkspace({
  workspace,
  projectUrl,
  expectedProject,
  accessToken,
  workspaceApi,
}) {
  if (!workspace) fail('The Ory workspace ID is required.');
  if (!accessToken && !workspaceApi) {
    fail('ORY_WORKSPACE_API_KEY is required.');
  }

  const api =
    workspaceApi ??
    new WorkspaceApi(
      new Configuration({
        basePath: 'https://api.console.ory.sh',
        accessToken,
      }),
    );
  const projects = await api.listWorkspaceProjects({ workspace });
  return resolveProjectTarget({ projects, projectUrl, expectedProject });
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || !value) {
      fail(`Invalid argument: ${flag ?? ''}`);
    }
    values.set(flag, value);
  }

  for (const required of [
    '--workspace',
    '--project-url',
    '--expected-project',
  ]) {
    if (!values.has(required)) fail(`${required} is required`);
  }
  return values;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const args = parseArgs(process.argv.slice(2));
    process.stdout.write(
      await resolveProjectTargetFromWorkspace({
        workspace: args.get('--workspace'),
        projectUrl: args.get('--project-url'),
        expectedProject: args.get('--expected-project'),
        accessToken: process.env.ORY_WORKSPACE_API_KEY,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error &&
      (error.message.startsWith('The Ory') ||
        error.message.startsWith('Expected one') ||
        error.message.startsWith('ORY_WORKSPACE'))
        ? error.message
        : 'Ory workspace project resolution failed.';
    console.error(`ERROR: ${message}`);
    process.exit(1);
  }
}
