import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import {
  createProjectGraphAsync,
  readProjectsConfigurationFromProjectGraph,
} from '@nx/devkit';

type PackageJson = {
  version?: string;
};

type Options = {
  project: string;
  stableMajorTag: string | null;
  dryRun: boolean;
};

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

function parsePublisherArgs(argv = process.argv.slice(2)): Options {
  const { values } = parseArgs({
    args: normalizeBooleanOptionValues(argv),
    options: {
      access: {
        type: 'string',
      },
      dryRun: {
        type: 'boolean',
      },
      'first-release': {
        type: 'boolean',
      },
      firstRelease: {
        type: 'boolean',
      },
      otp: {
        type: 'string',
      },
      project: {
        type: 'string',
      },
      registry: {
        type: 'string',
      },
      'stable-major-tag': {
        type: 'string',
      },
      tag: {
        type: 'string',
      },
      userconfig: {
        type: 'string',
      },
      'dry-run': {
        type: 'boolean',
      },
      verbose: {
        type: 'boolean',
      },
      yes: {
        type: 'boolean',
      },
    },
  });

  if (!values.project) {
    throw new Error('--project <name> is required');
  }

  return {
    project: values.project,
    stableMajorTag: values['stable-major-tag'] ?? null,
    dryRun:
      values['dry-run'] === true ||
      values.dryRun === true ||
      process.env.NX_DRY_RUN === 'true',
  };
}

function git(args: string[], options: { stdio?: 'ignore' | 'inherit' } = {}) {
  if (options.stdio) {
    execFileSync('git', args, {
      stdio: options.stdio,
      windowsHide: true,
    });
    return '';
  }
  return execFileSync('git', args, {
    encoding: 'utf-8',
    windowsHide: true,
  }).trim();
}

function assertGitPathClean(path: string) {
  try {
    git(['diff', '--quiet', '--', path], { stdio: 'ignore' });
    git(['diff', '--cached', '--quiet', '--', path], { stdio: 'ignore' });
  } catch (error) {
    throw new Error(
      `${path} is not committed. Run the Nx build target and commit the generated action bundle before releasing.`,
      { cause: error },
    );
  }
}

function assertSemver(version: string) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`GitHub Action package version is not semver: ${version}`);
  }
}

async function resolveProjectRoot(projectName: string) {
  const graph = await createProjectGraphAsync({ exitOnError: false });
  const projects = readProjectsConfigurationFromProjectGraph(graph).projects;
  const project = projects[projectName];
  if (!project) {
    throw new Error(`Unknown Nx project: ${projectName}`);
  }
  return project.root;
}

async function main() {
  const options = parsePublisherArgs();
  const projectRoot = await resolveProjectRoot(options.project);
  const packageJsonPath = join(projectRoot, 'package.json');
  const actionPath = join(projectRoot, 'action.yml');
  const bundlePath = join(projectRoot, 'dist/main.js');

  for (const path of [packageJsonPath, actionPath, bundlePath]) {
    if (!existsSync(path)) {
      throw new Error(`GitHub Action release artifact is missing: ${path}`);
    }
  }

  assertGitPathClean(bundlePath);

  const packageJson = JSON.parse(
    readFileSync(packageJsonPath, 'utf-8'),
  ) as PackageJson;
  if (!packageJson.version) {
    throw new Error(`${packageJsonPath} is missing version`);
  }
  assertSemver(packageJson.version);

  const major = packageJson.version.split('.')[0];
  const stableMajorTag = options.stableMajorTag ?? `v${major}`;
  const target = git(['rev-parse', 'HEAD']);

  process.stdout.write(
    `Publishing GitHub Action ${options.project} ${packageJson.version}\n` +
      `stable major tag: ${stableMajorTag} -> ${target}\n`,
  );

  if (options.dryRun) {
    process.stdout.write(
      `(dry-run) git tag -f ${stableMajorTag} ${target}\n` +
        `(dry-run) git push origin refs/tags/${stableMajorTag}:refs/tags/${stableMajorTag} --force\n`,
    );
    return;
  }

  if (process.env.GITHUB_ACTION_RELEASE_SKIP_PUSH === 'true') {
    process.stdout.write(
      `Skipped moving ${stableMajorTag}; GITHUB_ACTION_RELEASE_SKIP_PUSH=true\n`,
    );
    return;
  }

  git(['tag', '-f', stableMajorTag, target], { stdio: 'inherit' });
  git(
    [
      'push',
      'origin',
      `refs/tags/${stableMajorTag}:refs/tags/${stableMajorTag}`,
      '--force',
    ],
    { stdio: 'inherit' },
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
