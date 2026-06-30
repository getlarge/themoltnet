import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import {
  normalizeGoModuleVersion,
  readVersionFromGoProxy,
  resolveGoProxyUrl,
} from './go-version-actions';

function normalizeBooleanOptionValues(args: string[]) {
  const booleanOptions = new Set([
    'dry-run',
    'dryRun',
    'firstRelease',
    'first-release',
    'verbose',
    'yes',
  ]);
  return args.flatMap((arg) => {
    const match = /^--([^=]+)=(true|false)$/.exec(arg);
    if (!match || !booleanOptions.has(match[1])) {
      return [arg];
    }
    return match[2] === 'true' ? [`--${match[1]}`] : [];
  });
}

export function createCliOptions(argv = process.argv, env = process.env) {
  const { values } = parseArgs({
    args: normalizeBooleanOptionValues(argv.slice(2)),
    allowPositionals: false,
    options: {
      access: { type: 'string' },
      'dry-run': { type: 'boolean' },
      dryRun: { type: 'boolean' },
      'first-release': { type: 'boolean' },
      firstRelease: { type: 'boolean' },
      goproxy: { type: 'string' },
      otp: { type: 'string' },
      'project-root': { type: 'string' },
      registry: { type: 'string' },
      tag: { type: 'string' },
      'tag-prefix': { type: 'string' },
      userconfig: { type: 'string' },
      verbose: { type: 'boolean' },
      yes: { type: 'boolean' },
    },
  });

  return {
    dryRun:
      values['dry-run'] === true ||
      values.dryRun === true ||
      env.NX_DRY_RUN === 'true',
    goProxy: values.goproxy ?? env.GOPROXY ?? null,
    projectRoot: values['project-root'] ?? null,
    skipProxy: env.GO_RELEASE_SKIP_PROXY === 'true',
    tagPrefix: values['tag-prefix'] ?? null,
    verbose: values.verbose === true,
  };
}

function resolveProjectPath(cwd: string, projectRoot: string) {
  return isAbsolute(projectRoot) ? projectRoot : join(cwd, projectRoot);
}

function readGoModulePath(projectRoot: string) {
  const goModPath = join(projectRoot, 'go.mod');
  const goMod = readFileSync(goModPath, 'utf-8');
  const match = goMod.match(/^module\s+(\S+)/m);
  if (!match) {
    throw new Error(`Unable to read Go module path from ${goModPath}`);
  }
  return match[1];
}

function findReleaseVersionFromHead(cwd: string, tagPrefix: string) {
  const output = execFileSync('git', ['tag', '--points-at', 'HEAD'], {
    cwd,
    encoding: 'utf-8',
  });
  const matches = output
    .split('\n')
    .map((tag) => tag.trim())
    .filter((tag) => tag.startsWith(tagPrefix));

  if (matches.length === 0) {
    throw new Error(
      `Unable to find a release tag at HEAD with prefix ${tagPrefix}`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Found multiple release tags at HEAD with prefix ${tagPrefix}: ${matches.join(', ')}`,
    );
  }

  return normalizeGoModuleVersion(matches[0].slice(tagPrefix.length));
}

async function verifyGoProxyVersion(
  modulePath: string,
  version: string,
  proxyUrl: string | null,
  goProxy: string | null,
  cwd: string,
) {
  if (proxyUrl) {
    const resolvedVersion = await readVersionFromGoProxy(
      modulePath,
      version,
      proxyUrl,
    );
    if (resolvedVersion !== version) {
      throw new Error(
        `Go proxy ${proxyUrl} did not resolve ${modulePath}@v${version}`,
      );
    }
    return;
  }

  execFileSync('go', ['list', '-m', `${modulePath}@v${version}`], {
    cwd,
    env: {
      ...process.env,
      GOWORK: 'off',
      ...(goProxy ? { GOPROXY: goProxy } : {}),
    },
    stdio: 'inherit',
  });
}

export async function main(
  argv = process.argv,
  env = process.env,
  cwd = process.cwd(),
) {
  const { dryRun, goProxy, projectRoot, skipProxy, tagPrefix, verbose } =
    createCliOptions(argv, env);
  if (!projectRoot || !tagPrefix) {
    throw new Error(
      'Usage: go-module-publisher.cli.ts --project-root <path> --tag-prefix <prefix>',
    );
  }

  const modulePath = readGoModulePath(resolveProjectPath(cwd, projectRoot));
  const version = findReleaseVersionFromHead(cwd, tagPrefix);
  const proxyUrl = resolveGoProxyUrl({ registry: goProxy });

  if (dryRun) {
    process.stdout.write(
      `Would verify Go module ${modulePath}@v${version} through ${proxyUrl ?? goProxy ?? 'direct'}\n`,
    );
    return;
  }

  if (skipProxy) {
    process.stdout.write(
      `Verified local Go release tag ${tagPrefix}${version} for ${modulePath}; skipped GOPROXY lookup.\n`,
    );
    return;
  }

  await verifyGoProxyVersion(modulePath, version, proxyUrl, goProxy, cwd);

  if (verbose) {
    process.stdout.write(
      `Verified Go module ${modulePath}@v${version} through ${proxyUrl ?? goProxy ?? 'direct'}\n`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
