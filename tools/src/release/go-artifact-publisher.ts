import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js';
import { create as createTar } from 'tar';

import { createGoReleaseValidationLocalReplaces } from './go-version-actions';

type ArchiveFormat = 'tar.gz' | 'zip';
type ArtifactStore =
  | {
      provider?: 'none';
    }
  | {
      provider: 'github';
      releaseTag: string;
      create?: boolean;
      draft?: boolean;
      finalize?: boolean;
      upload?: boolean;
    };
export type GoReleaseBuild = {
  goos: string;
  goarch: string;
  goarm?: string;
  goamd64?: string;
  binary?: string;
  format?: ArchiveFormat;
  packageBinary?: {
    path: string;
  };
};
export type GoArtifactPublisherConfig = {
  projectRoot: string;
  main?: string;
  binary: string;
  version?:
    | string
    | {
        packageJson: string;
      };
  shortCommit?: string;
  distDir?: string;
  clean?: boolean;
  env?: Record<string, string>;
  ldflags?: string[];
  builds: GoReleaseBuild[];
  archives?: {
    nameTemplate?: string;
    defaultFormat?: ArchiveFormat;
    formatByGoos?: Record<string, ArchiveFormat>;
  };
  checksums?: {
    fileName?: string;
    algorithm?: 'sha256';
  };
  artifactStore?: ArtifactStore;
};
export type GoArtifactReleasePlan = {
  version: string;
  shortCommit: string;
  buildSteps: GoArtifactBuildStep[];
  checksumFile: string | null;
  uploadCommands: GoArtifactCommand[];
};
export type GoArtifactBuildStep = {
  goos: string;
  goarch: string;
  env: Record<string, string>;
  command: GoArtifactCommand;
  binaryPath: string;
  archivePath: string;
  archiveFormat: ArchiveFormat;
  packageBinaryPath: string | null;
};
export type GoArtifactCommand = {
  command: string;
  args: string[];
  cwd?: string;
};
type CreatePlanOptions = {
  cwd?: string;
  gitShortCommit?: string;
};
type RunOptions = CreatePlanOptions & {
  dryRun?: boolean;
  verbose?: boolean;
  commandRunner?: CommandRunner;
  toolChecker?: ToolChecker;
  useLocalReplaces?: boolean;
};
type CommandRunner = (
  command: GoArtifactCommand,
  env?: Record<string, string>,
) => void;
type ToolChecker = (command: string) => void;

const defaultBuilds: GoReleaseBuild[] = [
  { goos: 'linux', goarch: 'amd64' },
  { goos: 'linux', goarch: 'arm64' },
  { goos: 'darwin', goarch: 'amd64' },
  { goos: 'darwin', goarch: 'arm64' },
  { goos: 'windows', goarch: 'amd64', format: 'zip' },
  { goos: 'windows', goarch: 'arm64', format: 'zip' },
];

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function tryReadFile(path: string) {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

function resolveVersion(
  cwd: string,
  version: GoArtifactPublisherConfig['version'],
) {
  if (typeof version === 'string') {
    return version;
  }
  if (version?.packageJson) {
    const packageJson = readJsonFile<{ version?: string }>(
      join(cwd, version.packageJson),
    );
    if (packageJson.version) {
      return packageJson.version;
    }
  }
  throw new Error('Go artifact publisher config must define a version source');
}

function readGitShortCommit(cwd: string) {
  return execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], {
    cwd,
    encoding: 'utf-8',
    windowsHide: true,
  }).trim();
}

function resolveTemplate(
  template: string,
  values: Record<string, string | undefined>,
) {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_, key: string) => {
    if (!Object.hasOwn(values, key)) {
      throw new Error(`Unknown Go artifact template value: ${key}`);
    }
    return values[key] ?? '';
  });
}

function binaryName(build: GoReleaseBuild, fallback: string) {
  const name = build.binary ?? fallback;
  return build.goos === 'windows' && !name.endsWith('.exe')
    ? `${name}.exe`
    : name;
}

function archiveFormat(
  config: GoArtifactPublisherConfig,
  build: GoReleaseBuild,
) {
  return (
    build.format ??
    config.archives?.formatByGoos?.[build.goos] ??
    config.archives?.defaultFormat ??
    (build.goos === 'windows' ? 'zip' : 'tar.gz')
  );
}

function artifactContext(
  config: GoArtifactPublisherConfig,
  build: GoReleaseBuild,
  version: string,
  shortCommit: string,
) {
  return {
    binary: config.binary,
    version,
    shortCommit,
    goos: build.goos,
    goarch: build.goarch,
    goarm: build.goarm,
    goamd64: build.goamd64,
  };
}

function renderLdflags(
  flags: string[] | undefined,
  values: Record<string, string | undefined>,
) {
  if (!flags || flags.length === 0) {
    return [];
  }
  return [
    '-ldflags',
    flags.map((flag) => resolveTemplate(flag, values)).join(' '),
  ];
}

function checksumFilePath(config: GoArtifactPublisherConfig, cwd: string) {
  if (config.checksums === undefined) {
    return null;
  }
  return join(
    cwd,
    config.distDir ?? join(config.projectRoot, 'dist', 'nx-release'),
    config.checksums.fileName ?? 'checksums.txt',
  );
}

function releaseTag(
  artifactStore: ArtifactStore | undefined,
  version: string,
  shortCommit: string,
) {
  if (artifactStore?.provider !== 'github') {
    return null;
  }
  return resolveTemplate(artifactStore.releaseTag, {
    version,
    shortCommit,
  });
}

function createGithubReleaseCommand(
  artifactStore: Extract<ArtifactStore, { provider: 'github' }>,
  tag: string,
): GoArtifactCommand | null {
  if (artifactStore.create !== true) {
    return null;
  }
  return {
    command: 'gh',
    args: [
      'release',
      'create',
      tag,
      ...(artifactStore.draft !== false ? ['--draft'] : []),
      '--title',
      tag,
    ],
  };
}

function uploadGithubReleaseCommand(
  artifactStore: Extract<ArtifactStore, { provider: 'github' }>,
  tag: string,
  uploadFiles: string[],
): GoArtifactCommand | null {
  if (artifactStore.upload === false) {
    return null;
  }
  return {
    command: 'gh',
    args: ['release', 'upload', tag, ...uploadFiles, '--clobber'],
  };
}

function finalizeGithubReleaseCommand(
  artifactStore: Extract<ArtifactStore, { provider: 'github' }>,
  tag: string,
): GoArtifactCommand | null {
  if (artifactStore.finalize !== true) {
    return null;
  }
  return {
    command: 'gh',
    args: ['release', 'edit', tag, '--draft=false'],
  };
}

function githubReleaseUploadCommands(
  artifactStore: ArtifactStore | undefined,
  tag: string | null,
  uploadFiles: string[],
) {
  if (artifactStore?.provider !== 'github' || !tag) {
    return [];
  }

  return [
    createGithubReleaseCommand(artifactStore, tag),
    uploadGithubReleaseCommand(artifactStore, tag, uploadFiles),
    finalizeGithubReleaseCommand(artifactStore, tag),
  ].filter((command): command is GoArtifactCommand => command !== null);
}

export function createGoArtifactReleasePlan(
  config: GoArtifactPublisherConfig,
  options: CreatePlanOptions = {},
): GoArtifactReleasePlan {
  const cwd = options.cwd ?? process.cwd();
  const version = resolveVersion(cwd, config.version);
  const shortCommit =
    config.shortCommit ?? options.gitShortCommit ?? readGitShortCommit(cwd);
  const distDir = join(
    cwd,
    config.distDir ?? join(config.projectRoot, 'dist', 'nx-release'),
  );
  const builds = config.builds.length > 0 ? config.builds : defaultBuilds;
  const archiveNameTemplate =
    config.archives?.nameTemplate ??
    '{binary}_{version}_{goos}_{goarch}{goarm}{goamd64}';

  const buildSteps = builds.map((build) => {
    const values = artifactContext(config, build, version, shortCommit);
    const targetName = [build.goos, build.goarch, build.goarm, build.goamd64]
      .filter(Boolean)
      .join('_');
    const targetBinaryName = binaryName(build, config.binary);
    const binaryPath = join(distDir, 'bin', targetName, targetBinaryName);
    const format = archiveFormat(config, build);
    const archiveBaseName = resolveTemplate(archiveNameTemplate, values);
    const archivePath = join(distDir, `${archiveBaseName}.${format}`);
    const env = {
      ...config.env,
      GOOS: build.goos,
      GOARCH: build.goarch,
      ...(build.goarm ? { GOARM: build.goarm } : {}),
      ...(build.goamd64 ? { GOAMD64: build.goamd64 } : {}),
    };

    return {
      goos: build.goos,
      goarch: build.goarch,
      env,
      command: {
        command: 'go',
        args: [
          'build',
          '-o',
          binaryPath,
          ...renderLdflags(config.ldflags, values),
          config.main ?? '.',
        ],
        cwd: join(cwd, config.projectRoot),
      },
      binaryPath,
      archivePath,
      archiveFormat: format,
      packageBinaryPath: build.packageBinary
        ? join(cwd, build.packageBinary.path)
        : null,
    };
  });

  const tag = releaseTag(config.artifactStore, version, shortCommit);
  const checksumFile = checksumFilePath(config, cwd);
  const uploadFiles = [
    ...buildSteps.map((step) => step.archivePath),
    ...(checksumFile ? [checksumFile] : []),
  ];
  const uploadCommands = githubReleaseUploadCommands(
    config.artifactStore,
    tag,
    uploadFiles,
  );

  return {
    version,
    shortCommit,
    buildSteps,
    checksumFile,
    uploadCommands,
  };
}

function runCommand(
  command: GoArtifactCommand,
  env: Record<string, string> = {},
) {
  execFileSync(command.command, command.args, {
    cwd: command.cwd,
    env: {
      ...process.env,
      ...env,
    },
    stdio: 'inherit',
    windowsHide: true,
  });
}

function assertCommandAvailable(command: string) {
  const versionArgs = command === 'go' ? ['version'] : ['--version'];
  try {
    execFileSync(command, versionArgs, {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(
      `Required release tool "${command}" is not available on PATH.`,
      { cause: error },
    );
  }
}

function checkRequiredTools(
  plan: GoArtifactReleasePlan,
  toolChecker: ToolChecker,
) {
  if (plan.buildSteps.length > 0) {
    toolChecker('go');
  }
  if (plan.uploadCommands.some((command) => command.command === 'gh')) {
    toolChecker('gh');
  }
}

async function applyLocalGoReplaces(
  cwd: string,
  projectRoot: string,
  commandRunner: CommandRunner,
) {
  const replaces = await createGoReleaseValidationLocalReplaces(
    cwd,
    projectRoot,
  );
  const projectCwd = join(cwd, projectRoot);
  for (const replacement of replaces) {
    process.stdout.write(
      `Temporarily replacing ${replacement.modulePath} => ${replacement.replacementPath} for Go artifact build in ${projectRoot}\n`,
    );
    commandRunner(
      {
        command: 'go',
        args: [
          'mod',
          'edit',
          '-replace',
          `${replacement.modulePath}=${replacement.replacementPath}`,
        ],
        cwd: projectCwd,
      },
      { GOWORK: 'off' },
    );
  }
}

function restoreGoModuleFiles(cwd: string, projectRoot: string) {
  const goModPath = join(cwd, projectRoot, 'go.mod');
  const goSumPath = join(cwd, projectRoot, 'go.sum');
  const goMod = tryReadFile(goModPath);
  const goSum = tryReadFile(goSumPath);
  return () => {
    if (goMod !== null) {
      writeFileSync(goModPath, goMod);
    }
    if (goSum !== null) {
      writeFileSync(goSumPath, goSum);
    }
  };
}

async function archiveBinary(step: GoArtifactBuildStep) {
  mkdirSync(dirname(step.archivePath), { recursive: true });
  if (step.archiveFormat === 'tar.gz') {
    await createTar(
      {
        cwd: dirname(step.binaryPath),
        file: step.archivePath,
        gzip: true,
        noMtime: true,
        portable: true,
      },
      [basename(step.binaryPath)],
    );
    return;
  }

  const writer = new Uint8ArrayWriter();
  const zipWriter = new ZipWriter(writer);
  await zipWriter.add(
    basename(step.binaryPath),
    new Uint8ArrayReader(readFileSync(step.binaryPath)),
  );
  const zipData = await zipWriter.close();
  writeFileSync(step.archivePath, Buffer.from(zipData));
}

function writeChecksums(checksumFile: string, archivePaths: string[]) {
  mkdirSync(dirname(checksumFile), { recursive: true });
  const lines = archivePaths.map((archivePath) => {
    const digest = createHash('sha256')
      .update(readFileSync(archivePath))
      .digest('hex');
    return `${digest}  ${basename(archivePath)}`;
  });
  writeFileSync(checksumFile, `${lines.join('\n')}\n`);
}

function copyPackageBinary(step: GoArtifactBuildStep) {
  if (!step.packageBinaryPath) {
    return;
  }
  mkdirSync(dirname(step.packageBinaryPath), { recursive: true });
  copyFileSync(step.binaryPath, step.packageBinaryPath);
  if (!step.packageBinaryPath.endsWith('.exe')) {
    chmodSync(step.packageBinaryPath, 0o755);
  }
}

function formatCommand(
  command: GoArtifactCommand,
  env?: Record<string, string>,
) {
  const envPrefix = env
    ? Object.entries(env)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ')
    : '';
  return `${envPrefix ? `${envPrefix} ` : ''}${command.command} ${command.args.join(
    ' ',
  )}`;
}

export function printGoArtifactReleasePlan(plan: GoArtifactReleasePlan) {
  process.stdout.write(`Go artifact release plan for ${plan.version}\n`);
  for (const step of plan.buildSteps) {
    process.stdout.write(`${formatCommand(step.command, step.env)}\n`);
    process.stdout.write(
      `archive ${relative(process.cwd(), step.archivePath)}\n`,
    );
    if (step.packageBinaryPath) {
      process.stdout.write(
        `copy ${relative(process.cwd(), step.packageBinaryPath)}\n`,
      );
    }
  }
  if (plan.checksumFile) {
    process.stdout.write(
      `checksum ${relative(process.cwd(), plan.checksumFile)}\n`,
    );
  }
  for (const command of plan.uploadCommands) {
    process.stdout.write(`${formatCommand(command)}\n`);
  }
}

export async function runGoArtifactPublisher(
  config: GoArtifactPublisherConfig,
  options: RunOptions = {},
) {
  const plan = createGoArtifactReleasePlan(config, options);
  const commandRunner = options.commandRunner ?? runCommand;
  const toolChecker = options.toolChecker ?? assertCommandAvailable;

  if (options.dryRun) {
    printGoArtifactReleasePlan(plan);
    return plan;
  }

  checkRequiredTools(plan, toolChecker);

  const restoreGoFiles = options.useLocalReplaces
    ? restoreGoModuleFiles(options.cwd ?? process.cwd(), config.projectRoot)
    : null;
  try {
    if (options.useLocalReplaces) {
      await applyLocalGoReplaces(
        options.cwd ?? process.cwd(),
        config.projectRoot,
        commandRunner,
      );
    }

    for (const step of plan.buildSteps) {
      if (options.verbose) {
        process.stdout.write(`${formatCommand(step.command, step.env)}\n`);
      }
      mkdirSync(dirname(step.binaryPath), { recursive: true });
      commandRunner(step.command, step.env);
      await archiveBinary(step);
      copyPackageBinary(step);
    }
  } finally {
    restoreGoFiles?.();
  }

  if (plan.checksumFile) {
    writeChecksums(
      plan.checksumFile,
      plan.buildSteps.map((step) => step.archivePath),
    );
  }

  for (const command of plan.uploadCommands) {
    commandRunner(command, {});
  }

  return plan;
}

export function readGoArtifactPublisherConfig(path: string) {
  const config = readJsonFile<GoArtifactPublisherConfig>(path);
  if (!config.projectRoot) {
    throw new Error('Go artifact publisher config is missing projectRoot');
  }
  if (!config.binary) {
    throw new Error('Go artifact publisher config is missing binary');
  }
  if (!Array.isArray(config.builds)) {
    throw new Error('Go artifact publisher config is missing builds');
  }
  return config;
}
