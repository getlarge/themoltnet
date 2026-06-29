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
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const opts = { tag: 'dev', push: false, cacheTo: true, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') opts.project = argv[++i];
    else if (a === '--tag') opts.tag = argv[++i];
    else if (a === '--push') opts.push = true;
    else if (a === '--no-cache-to') opts.cacheTo = false;
    else if (a === '--dry-run') opts.dryRun = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!opts.project) throw new Error('--project <package-name> is required');
  return opts;
}

// {package name -> projectRoot} by scanning apps/* and libs/*. Avoids loading
// the Nx graph (and its dotenvx .env leak, see #1306/#1507).
function findProjectRoot(pkgName) {
  for (const base of ['apps', 'libs']) {
    for (const dir of readdirSync(base, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const root = join(base, dir.name);
      try {
        if (
          JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name ===
          pkgName
        ) {
          return root;
        }
      } catch {
        // no package.json here; skip
      }
    }
  }
  throw new Error(
    `Could not find projectRoot for ${pkgName} under apps/|libs/`,
  );
}

// Matches @nx/docker getDefaultImageReference(projectRoot): the tag nx release
// retags from. projectRoot with separators -> '-', lowercased.
function pathDerivedRef(projectRoot) {
  return projectRoot
    .replace(/^[\\/]/, '')
    .replace(/[\\/\s]+/g, '-')
    .toLowerCase();
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  const nxConfig = JSON.parse(readFileSync('nx.json', 'utf8'));
  const registryUrl = nxConfig.release?.docker?.registryUrl;
  if (!registryUrl)
    throw new Error('nx.json release.docker.registryUrl is not set');

  const projectRoot = findProjectRoot(opts.project);
  const pkg = JSON.parse(
    readFileSync(join(projectRoot, 'package.json'), 'utf8'),
  );
  const repositoryName = pkg.nx?.release?.docker?.repositoryName;
  if (!repositoryName) {
    throw new Error(
      `${opts.project} has no nx.release.docker.repositoryName in package.json`,
    );
  }

  const sourceRef = pathDerivedRef(projectRoot); // e.g. apps-rest-api (nx release)
  const cleanRef = `${registryUrl}/${repositoryName}:${opts.tag}`; // e.g. ghcr.io/getlarge/themoltnet/rest-api:dev
  const cacheRef = `${registryUrl}/${repositoryName}:buildcache`;
  const dockerfile = join(projectRoot, 'Dockerfile');

  const commitSha = process.env.GITHUB_SHA ?? '';

  const args = [
    'buildx',
    'build',
    '-f',
    dockerfile,
    '--platform',
    'linux/amd64',
    '--tag',
    sourceRef,
    '--tag',
    cleanRef,
    '--label',
    'org.opencontainers.image.created=' + new Date().toISOString(),
  ];
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
      `  source tag : ${sourceRef}\n` +
      `  clean tag  : ${cleanRef}\n` +
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

main();
