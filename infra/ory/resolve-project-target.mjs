#!/usr/bin/env node

import { readFileSync } from 'node:fs';
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
    '--projects',
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
    const projects = JSON.parse(readFileSync(args.get('--projects'), 'utf8'));
    process.stdout.write(
      resolveProjectTarget({
        projects,
        projectUrl: args.get('--project-url'),
        expectedProject: args.get('--expected-project'),
      }),
    );
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}
