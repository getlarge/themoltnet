// Single source of truth for building a MoltNet Docker image (issue #1498).
//
// Replaces the @nx/docker plugin's inferred `docker build` for our images. The
// plugin's `{projectName}` token resolves to the scoped package name
// (`@moltnet/rest-api`), which is not a valid image segment, and its per-project
// arg/env interpolation is too limited to express our tag + cache + push needs.
// Rather than fight it, each docker-images project's `docker:build` target runs
// this script.
//
// It builds with `docker buildx build` and applies TWO tags:
//   1. the path-derived ref (e.g. `apps-rest-api`) — REQUIRED by `nx release`,
//      which retags from `getDefaultImageReference(projectRoot)`.
//   2. the clean registry ref `${registryUrl}/${repositoryName}:${tag}`
//      (e.g. `ghcr.io/getlarge/themoltnet/rest-api:dev`) — consumed by the e2e
//      Compose stack and CI e2e jobs.
// The clean name + registry come from `nx.release.docker.repositoryName` (per
// project) + `release.docker.registryUrl` (nx.json), so local `:dev` tags, CI
// `:ci-<sha>` tags, and `nx release` tags can never drift from each other.
//
// Usage:
//   node tools/docker-build.mjs --project <@scope/name> [options]
//
// Options:
//   --project <name>   workspace package name (required), e.g. @moltnet/rest-api
//   --tag <suffix>     clean-ref tag suffix (default "dev"), e.g. ci-<sha>
//   --push             push to the registry (buildx --push); default is --load
//   --no-cache-to      skip writing the registry build cache (e.g. on PRs from
//                      forks without registry write access)
//   --dry-run          print the docker command without running it
//
// Local dev (load into daemon, :dev):   node tools/docker-build.mjs --project @moltnet/rest-api
// CI (push, :ci-<sha>):                  node tools/docker-build.mjs --project @moltnet/rest-api --push --tag ci-$GITHUB_SHA

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { parseArgs as nodeParseArgs } from 'node:util';

import {
  createProjectGraphAsync,
  readProjectsConfigurationFromProjectGraph,
} from '@nx/devkit';

function parseArgs(argv) {
  const { values } = nodeParseArgs({
    args: argv,
    options: {
      project: { type: 'string' },
      tag: { type: 'string', default: 'dev' },
      push: { type: 'boolean', default: false },
      'no-cache-to': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (!values.project) throw new Error('--project <package-name> is required');
  return {
    project: values.project,
    tag: values.tag,
    push: values.push,
    cacheTo: !values['no-cache-to'],
    dryRun: values['dry-run'],
  };
}

// Matches @nx/docker getDefaultImageReference(projectRoot): the tag nx release
// retags from. projectRoot with separators -> '-', lowercased.
function pathDerivedRef(projectRoot) {
  return projectRoot
    .replace(/^[\\/]/, '')
    .replace(/[\\/\s]+/g, '-')
    .toLowerCase();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // Read just the registry from nx.json. devkit's readNxJson() requires a Tree
  // (generator API) and the disk-reading variant is an unstable internal import,
  // so a direct read of this one field at the known workspace-root path is the
  // stable choice.
  const registryUrl = JSON.parse(readFileSync('nx.json', 'utf8'))?.release
    ?.docker?.registryUrl;
  if (!registryUrl)
    throw new Error('nx.json release.docker.registryUrl is not set');

  // Resolve the project's root + release config from the Nx project graph
  // (createProjectGraphAsync does not leak the dotenvx .env into process.env —
  // verified — so this is safe to use here despite #1306/#1507).
  const graph = await createProjectGraphAsync({ exitOnError: false });
  const project =
    readProjectsConfigurationFromProjectGraph(graph).projects[opts.project];
  if (!project) {
    throw new Error(`Unknown Nx project: ${opts.project}`);
  }
  const projectRoot = project.root;
  const repositoryName = project.release?.docker?.repositoryName;
  if (!repositoryName) {
    throw new Error(`${opts.project} has no nx.release.docker.repositoryName`);
  }

  const sourceRef = pathDerivedRef(projectRoot); // e.g. apps-rest-api (nx release)
  const cleanRef = `${registryUrl}/${repositoryName}:${opts.tag}`; // e.g. ghcr.io/getlarge/themoltnet/rest-api:dev
  const cacheRef = `${registryUrl}/${repositoryName}:buildcache`;
  // Moving "last built from main" ref. On main pushes we publish it alongside
  // the immutable :ci-<sha> so PR e2e runs can pull a fresh image for the
  // services they did NOT change (the e2e stack needs all of them). See the
  // per-image tag resolution in the e2e jobs (.github/workflows/ci.yml).
  const mainRef = `${registryUrl}/${repositoryName}:ci-main`;
  const dockerfile = join(projectRoot, 'Dockerfile');

  const commitSha = process.env.GITHUB_SHA ?? '';
  const isMainBuild = opts.push && process.env.GITHUB_REF === 'refs/heads/main';

  const args = [
    'buildx',
    'build',
    '-f',
    dockerfile,
    '--platform',
    'linux/amd64',
    '--tag',
    cleanRef,
    '--label',
    'org.opencontainers.image.created=' + new Date().toISOString(),
  ];
  // The path-derived ref (apps-rest-api) has NO registry, so `--push` would
  // resolve it to docker.io/library/apps-rest-api and fail with a 401. It is
  // only needed in --load mode, where `nx release` later retags from it in the
  // local daemon. Never tag it when pushing.
  if (!opts.push) {
    args.push('--tag', sourceRef);
  }
  if (isMainBuild) {
    args.push('--tag', mainRef);
  }
  if (commitSha) {
    args.push('--label', `org.opencontainers.image.revision=${commitSha}`);
  }
  // Registry build cache requires a buildx `docker-container` builder, which
  // CI sets up (docker/setup-buildx-action) and local typically does not (the
  // default `docker` driver rejects `--cache-to type=registry`). Gate cache on
  // --push: CI pushes and has the container driver; local --load builds rely on
  // the daemon's own layer cache. Override the gate with --no-cache-to if ever
  // pushing from a plain-driver environment.
  if (opts.push) {
    args.push('--cache-from', `type=registry,ref=${cacheRef}`);
    if (opts.cacheTo) {
      args.push('--cache-to', `type=registry,ref=${cacheRef},mode=max`);
    }
  }
  // buildx requires exactly one output mode. --push uploads to the registry;
  // --load materializes the image in the local daemon (single-platform only),
  // which both the e2e Compose stack and `nx release`'s `docker tag` need.
  args.push(opts.push ? '--push' : '--load');
  args.push('.'); // build context = repo root (Dockerfiles COPY . .)

  process.stdout.write(
    `[docker-build] ${opts.project}\n` +
      (opts.push ? '' : `  source tag : ${sourceRef} (load only)\n`) +
      `  clean tag  : ${cleanRef}\n` +
      (isMainBuild ? `  main tag   : ${mainRef}\n` : '') +
      `  cache ref  : ${cacheRef}\n` +
      `  mode       : ${opts.push ? 'push' : 'load'}\n`,
  );

  if (opts.dryRun) {
    process.stdout.write(`  (dry-run) docker ${args.join(' ')}\n`);
    return;
  }

  execFileSync('docker', args, {
    stdio: 'inherit',
    env: { ...process.env, DOCKER_BUILDKIT: '1' },
    windowsHide: true,
  });
}

main().catch((err) => {
  process.stderr.write(`[docker-build] ${err.message}\n`);
  process.exit(1);
});
