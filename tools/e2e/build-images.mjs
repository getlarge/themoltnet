// Build the e2e Docker images via Nx (`docker:build`) and retag them with the
// clean, registry-namespaced names the e2e Compose stack consumes.
//
// Why this exists (see issue #1498):
//   The @nx/docker plugin's `docker:build` tags each image with a path-derived
//   default ref (`apps-rest-api`, `libs-database`, …) because its `{projectName}`
//   token resolves to the scoped package name (`@moltnet/rest-api`), which is not
//   a valid Docker image segment. That path-derived tag is also exactly the
//   source `nx release` retags from, so we must NOT replace it.
//
//   Instead we build with the default tag, then add a clean alias
//   (`ghcr.io/getlarge/themoltnet/<name>:dev`) with a metadata-only `docker tag`
//   (no rebuild). The clean name + registry come from each project's
//   `nx.release.docker.repositoryName` + the release `registryUrl`, so the local
//   `:dev` tags and the `nx release` tags can never drift apart.
//
// Usage: node tools/e2e/build-images.mjs [--tag <tag>] [--dry-run]
//   --tag     image tag for the clean alias (default: "dev")
//   --dry-run print the plan without building or tagging
//
// By default only the projects the e2e Compose stack actually runs are built
// (E2E_STACK_PROJECTS). Override that env var (comma-separated package names) to
// build a different set, e.g. to include `@moltnet/landing`.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const tagIdx = args.indexOf('--tag');
const tag = tagIdx >= 0 ? args[tagIdx + 1] : 'dev';

const nxConfig = JSON.parse(readFileSync('nx.json', 'utf8'));
const registryUrl = nxConfig.release?.docker?.registryUrl;
if (!registryUrl) {
  throw new Error('nx.json release.docker.registryUrl is not set');
}

const allDockerProjects =
  nxConfig.release?.groups?.['docker-images']?.projects ?? [];
if (!Array.isArray(allDockerProjects) || allDockerProjects.length === 0) {
  throw new Error('No projects in nx.json release.groups.docker-images');
}

// Default to the services the e2e Compose stack consumes (landing has no e2e
// consumer, so it's excluded). Override with E2E_STACK_PROJECTS.
const DEFAULT_E2E_PROJECTS = [
  '@moltnet/rest-api',
  '@moltnet/mcp-server',
  '@moltnet/console',
  '@moltnet/mcp-host',
  '@moltnet/database',
];
const projects = (
  process.env.E2E_STACK_PROJECTS?.split(',')
    .map((p) => p.trim())
    .filter(Boolean) ?? DEFAULT_E2E_PROJECTS
).filter((p) => allDockerProjects.includes(p));

// Build a {package name -> projectRoot} index by scanning apps/* and libs/* for
// package.json. Avoids `nx show project` (whose pnpm wrapper pollutes stdout
// with platform warnings) and needs no Nx graph load.
function buildRootIndex() {
  const index = new Map();
  for (const base of ['apps', 'libs']) {
    for (const dir of readdirSync(base, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const root = join(base, dir.name);
      try {
        const name = JSON.parse(
          readFileSync(join(root, 'package.json'), 'utf8'),
        ).name;
        if (name) index.set(name, root);
      } catch {
        // no package.json in this dir; skip
      }
    }
  }
  return index;
}

const rootIndex = buildRootIndex();

function getProjectRoot(project) {
  const root = rootIndex.get(project);
  if (!root) {
    throw new Error(
      `Could not find projectRoot for ${project} under apps/|libs/`,
    );
  }
  return root;
}

// Matches @nx/docker getDefaultImageReference(projectRoot).
function defaultImageRef(projectRoot) {
  return projectRoot
    .replace(/^[\\/]/, '')
    .replace(/[\\/\s]+/g, '-')
    .toLowerCase();
}

const plan = projects.map((project) => {
  const projectRoot = getProjectRoot(project);
  const repositoryName = JSON.parse(
    readFileSync(join(projectRoot, 'package.json'), 'utf8'),
  ).nx?.release?.docker?.repositoryName;
  if (!repositoryName) {
    throw new Error(
      `${project} has no nx.release.docker.repositoryName in package.json`,
    );
  }
  return {
    project,
    source: defaultImageRef(projectRoot),
    target: `${registryUrl}/${repositoryName}:${tag}`,
  };
});

process.stdout.write(
  `e2e image build plan (tag "${tag}"):\n` +
    plan.map((p) => `  ${p.source}  ->  ${p.target}`).join('\n') +
    '\n',
);

if (dryRun) {
  process.stdout.write('Dry run: not building or tagging.\n');
  process.exit(0);
}

// Build all images in one Nx invocation (cache + dependency ordering).
execFileSync(
  'pnpm',
  [
    'exec',
    'nx',
    'run-many',
    '-t',
    'docker:build',
    '--projects',
    projects.join(','),
  ],
  { stdio: 'inherit', windowsHide: true },
);

// Retag each built image with its clean alias (metadata-only, no rebuild).
for (const { source, target } of plan) {
  execFileSync('docker', ['tag', source, target], {
    stdio: 'inherit',
    windowsHide: true,
  });
}

process.stdout.write(`Tagged ${plan.length} e2e images with :${tag}.\n`);
