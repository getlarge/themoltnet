import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import {
  createProjectGraphAsync,
  readProjectsConfigurationFromProjectGraph,
} from '@nx/devkit';

import {
  authHeaderValue,
  missingBundleEntries,
  stableMajorTagFor,
  tagPushCommand,
} from './github-action-release.js';

type PackageJson = {
  version?: string;
};

type Options = {
  project: string;
  entries: string[];
  /** Other action projects whose committed bundles this action runs. */
  alsoVerify: string[];
  stableMajorTagPrefix: string;
  dryRun: boolean;
};

function normalizeBooleanOptionValues(args: string[]) {
  const booleanOptions = new Set([
    'dry-run',
    'dryRun',
    'firstRelease',
    'first-release',
    'provenance',
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
      provenance: {
        type: 'boolean',
      },
      registry: {
        type: 'string',
      },
      entries: {
        type: 'string',
      },
      'stable-major-tag-prefix': {
        type: 'string',
      },
      'also-verify': {
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
    entries: (values.entries ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
    alsoVerify: (values['also-verify'] ?? '')
      .split(',')
      .map((project) => project.trim())
      .filter(Boolean),
    stableMajorTagPrefix: values['stable-major-tag-prefix'] ?? 'v',
    dryRun:
      values['dry-run'] === true ||
      values.dryRun === true ||
      process.env.NX_DRY_RUN === 'true',
  };
}

function git(
  args: string[],
  options: { stdio?: 'ignore' | 'inherit'; env?: Record<string, string> } = {},
) {
  if (options.stdio) {
    execFileSync('git', args, {
      stdio: options.stdio,
      windowsHide: true,
      env: { ...process.env, ...options.env },
    });
    return '';
  }
  return execFileSync('git', args, {
    encoding: 'utf-8',
    windowsHide: true,
  }).trim();
}

// `git status --porcelain`, not `git diff`: the bundle code-splits into
// content-hashed chunks, and a renamed chunk is untracked, which `git diff`
// does not report.
function assertBundleCommitted(bundleDir: string) {
  const changes = git(['status', '--porcelain', '--', bundleDir]);
  if (changes) {
    throw new Error(
      `${bundleDir} does not match its sources:\n${changes}\n` +
        'Merge the open "chore(actions): refresh action bundles" PR ' +
        '(branch automation/action-bundle-sync, opened by sync-action-bundle.yml) ' +
        'or commit a rebuilt bundle before releasing.',
    );
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
  const bundleDir = join(projectRoot, 'dist');

  for (const path of [packageJsonPath, actionPath, bundleDir]) {
    if (!existsSync(path)) {
      throw new Error(`GitHub Action release artifact is missing: ${path}`);
    }
  }
  // Each action runs its own entry points (`node dist/<entry>`).
  const missing = missingBundleEntries(bundleDir, options.entries);
  if (missing.length > 0) {
    throw new Error(
      `GitHub Action bundle ${bundleDir} lacks: ${missing.join(', ')}`,
    );
  }

  assertBundleCommitted(bundleDir);
  // A workflow at this tag may also run another action's bundle from the
  // same commit; a stale one must not ship under this release.
  for (const other of options.alsoVerify) {
    assertBundleCommitted(join(await resolveProjectRoot(other), 'dist'));
  }

  const packageJson = JSON.parse(
    readFileSync(packageJsonPath, 'utf-8'),
  ) as PackageJson;
  if (!packageJson.version) {
    throw new Error(`${packageJsonPath} is missing version`);
  }
  const stableMajorTag = stableMajorTagFor(
    packageJson.version,
    options.stableMajorTagPrefix,
  );
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
  // The release job checks out without persisted credentials and hands the
  // token to this one push.
  const token = process.env.GITHUB_ACTION_RELEASE_TOKEN;
  if (token && process.env.GITHUB_ACTIONS === 'true') {
    process.stdout.write(`::add-mask::${authHeaderValue(token)}\n`);
  }
  const push = tagPushCommand(
    stableMajorTag,
    token,
    process.env.GITHUB_SERVER_URL,
  );
  git(push.args, { stdio: 'inherit', env: push.env });
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
