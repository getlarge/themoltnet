import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  createGoArtifactReleasePlan,
  type GoArtifactCommand,
  readGoArtifactPublisherConfig,
  runGoArtifactPublisher,
} from './go-artifact-publisher';
import {
  applyCliOverrides,
  createCliRunOptions,
  resolveConfigPath,
} from './go-artifact-publisher.cli';

const workspaceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

function writePackageJson(root: string, version = '1.2.3') {
  mkdirSync(join(root, 'packages/cli'), { recursive: true });
  writeFileSync(
    join(root, 'packages/cli/package.json'),
    JSON.stringify({ version }),
  );
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

describe('go artifact publisher', () => {
  it('plans cross-platform archives, ldflags, and package binary staging', () => {
    const cwd = '/repo';
    const plan = createGoArtifactReleasePlan(
      {
        projectRoot: 'apps/my-cli',
        binary: 'my-cli',
        version: '1.2.3',
        shortCommit: 'abc12345',
        distDir: 'apps/my-cli/dist/release',
        env: {
          CGO_ENABLED: '0',
          GOWORK: 'off',
        },
        ldflags: [
          '-s',
          '-w',
          '-X main.version={version}',
          '-X main.commit={shortCommit}',
        ],
        builds: [
          {
            goos: 'linux',
            goarch: 'amd64',
            packageBinary: {
              path: 'packages/my-cli/npm/linux-x64/bin/my-cli',
            },
          },
          {
            goos: 'windows',
            goarch: 'arm64',
            packageBinary: {
              path: 'packages/my-cli/npm/win32-arm64/bin/my-cli.exe',
            },
          },
        ],
        archives: {
          nameTemplate: '{binary}_{version}_{goos}_{goarch}',
        },
        checksums: {
          fileName: 'checksums.txt',
        },
        artifactStore: {
          provider: 'github',
          releaseTag: 'cli-v{version}',
          upload: true,
        },
      },
      { cwd },
    );

    expect(plan.version).toBe('1.2.3');
    expect(plan.buildSteps).toMatchObject([
      {
        env: {
          CGO_ENABLED: '0',
          GOWORK: 'off',
          GOOS: 'linux',
          GOARCH: 'amd64',
        },
        command: {
          command: 'go',
          cwd: '/repo/apps/my-cli',
          args: [
            'build',
            '-o',
            '/repo/apps/my-cli/dist/release/bin/linux_amd64/my-cli',
            '-ldflags',
            '-s -w -X main.version=1.2.3 -X main.commit=abc12345',
            '.',
          ],
        },
        archivePath:
          '/repo/apps/my-cli/dist/release/my-cli_1.2.3_linux_amd64.tar.gz',
        packageBinaryPath: '/repo/packages/my-cli/npm/linux-x64/bin/my-cli',
      },
      {
        env: {
          CGO_ENABLED: '0',
          GOWORK: 'off',
          GOOS: 'windows',
          GOARCH: 'arm64',
        },
        binaryPath:
          '/repo/apps/my-cli/dist/release/bin/windows_arm64/my-cli.exe',
        archivePath:
          '/repo/apps/my-cli/dist/release/my-cli_1.2.3_windows_arm64.zip',
        packageBinaryPath:
          '/repo/packages/my-cli/npm/win32-arm64/bin/my-cli.exe',
      },
    ]);
    expect(plan.checksumFile).toBe(
      '/repo/apps/my-cli/dist/release/checksums.txt',
    );
    expect(plan.uploadCommands).toEqual([
      {
        command: 'gh',
        args: [
          'release',
          'upload',
          'cli-v1.2.3',
          '/repo/apps/my-cli/dist/release/my-cli_1.2.3_linux_amd64.tar.gz',
          '/repo/apps/my-cli/dist/release/my-cli_1.2.3_windows_arm64.zip',
          '/repo/apps/my-cli/dist/release/checksums.txt',
          '--clobber',
        ],
      },
    ]);
  });

  it('keeps variant build archive paths unique by default', () => {
    const plan = createGoArtifactReleasePlan(
      {
        projectRoot: 'apps/my-cli',
        binary: 'my-cli',
        version: '1.2.3',
        shortCommit: 'abc12345',
        builds: [
          { goos: 'linux', goarch: 'arm', goarm: '6' },
          { goos: 'linux', goarch: 'arm', goarm: '7' },
          { goos: 'linux', goarch: 'amd64', goamd64: 'v3' },
        ],
      },
      { cwd: '/repo' },
    );

    expect(plan.buildSteps.map((step) => step.archivePath)).toEqual([
      '/repo/apps/my-cli/dist/nx-release/my-cli_1.2.3_linux_arm6.tar.gz',
      '/repo/apps/my-cli/dist/nx-release/my-cli_1.2.3_linux_arm7.tar.gz',
      '/repo/apps/my-cli/dist/nx-release/my-cli_1.2.3_linux_amd64v3.tar.gz',
    ]);
    expect(new Set(plan.buildSteps.map((step) => step.archivePath)).size).toBe(
      3,
    );
  });

  it('can disable artifact upload for plugin consumers that publish elsewhere', () => {
    const plan = createGoArtifactReleasePlan(
      {
        projectRoot: 'apps/my-cli',
        binary: 'my-cli',
        version: '1.2.3',
        shortCommit: 'abc12345',
        builds: [{ goos: 'linux', goarch: 'amd64' }],
        checksums: {},
        artifactStore: {
          provider: 'none',
        },
      },
      { cwd: '/repo' },
    );

    expect(plan.uploadCommands).toEqual([]);
  });

  it('can read the release version from package.json', () => {
    const cwd = '/tmp/go-artifact-publisher-test';
    writePackageJson(cwd, '2.3.4');

    const plan = createGoArtifactReleasePlan(
      {
        projectRoot: 'apps/my-cli',
        binary: 'my-cli',
        version: {
          packageJson: 'packages/cli/package.json',
        },
        shortCommit: 'abc12345',
        builds: [{ goos: 'darwin', goarch: 'arm64' }],
        checksums: {},
      },
      { cwd },
    );

    expect(plan.version).toBe('2.3.4');
  });

  it('builds, archives, stages package binaries, writes checksums, and uploads in order', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'go-artifact-publisher-run-'));
    const calls: string[] = [];
    const toolChecks: string[] = [];
    const commandRunner = (
      command: GoArtifactCommand,
      env: Record<string, string> = {},
    ) => {
      calls.push(`${command.command}:${command.args[0]}`);
      if (command.command === 'go') {
        const outputPath = command.args[command.args.indexOf('-o') + 1];
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, `${env.GOOS}/${env.GOARCH}`);
        return;
      }
    };

    const plan = await runGoArtifactPublisher(
      {
        projectRoot: 'apps/my-cli',
        binary: 'my-cli',
        version: '1.2.3',
        shortCommit: 'abc12345',
        distDir: 'dist',
        builds: [
          {
            goos: 'linux',
            goarch: 'amd64',
            packageBinary: {
              path: 'npm/linux-x64/bin/my-cli',
            },
          },
          {
            goos: 'windows',
            goarch: 'amd64',
            packageBinary: {
              path: 'npm/win32-x64/bin/my-cli.exe',
            },
          },
        ],
        checksums: {
          fileName: 'checksums.txt',
        },
        artifactStore: {
          provider: 'github',
          releaseTag: 'cli-v{version}',
          upload: true,
        },
      },
      {
        cwd,
        commandRunner,
        toolChecker: (command) => {
          toolChecks.push(command);
        },
      },
    );

    expect(toolChecks).toEqual(['go', 'gh']);
    expect(calls).toEqual(['go:build', 'go:build', 'gh:release']);
    expect(readFileSync(join(cwd, 'npm/linux-x64/bin/my-cli'), 'utf-8')).toBe(
      'linux/amd64',
    );
    expect(
      readFileSync(join(cwd, 'npm/win32-x64/bin/my-cli.exe'), 'utf-8'),
    ).toBe('windows/amd64');
    expect(statSync(join(cwd, 'npm/linux-x64/bin/my-cli')).mode & 0o111).toBe(
      0o111,
    );
    const checksumLines = readFileSync(plan.checksumFile ?? '', 'utf-8')
      .trim()
      .split('\n');
    expect(checksumLines).toHaveLength(2);
    for (const step of plan.buildSteps) {
      expect(readFileSync(step.archivePath).byteLength).toBeGreaterThan(0);
      expect(checksumLines).toContain(
        `${createHash('sha256')
          .update(readFileSync(step.archivePath))
          .digest('hex')}  ${step.archivePath.split('/').at(-1)}`,
      );
    }
  });

  it('does not run commands during dry-run', async () => {
    const calls: GoArtifactCommand[] = [];
    const toolChecks: string[] = [];
    const stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    try {
      await runGoArtifactPublisher(
        {
          projectRoot: 'apps/my-cli',
          binary: 'my-cli',
          version: '1.2.3',
          shortCommit: 'abc12345',
          builds: [{ goos: 'linux', goarch: 'amd64' }],
        },
        {
          cwd: '/repo',
          dryRun: true,
          commandRunner: (command) => {
            calls.push(command);
          },
          toolChecker: (command) => {
            toolChecks.push(command);
          },
        },
      );
    } finally {
      stdout.mockRestore();
    }

    expect(calls).toEqual([]);
    expect(toolChecks).toEqual([]);
  });

  it('fails before building when a required release tool is missing', async () => {
    const calls: GoArtifactCommand[] = [];

    await expect(
      runGoArtifactPublisher(
        {
          projectRoot: 'apps/my-cli',
          binary: 'my-cli',
          version: '1.2.3',
          shortCommit: 'abc12345',
          builds: [{ goos: 'linux', goarch: 'amd64' }],
        },
        {
          cwd: '/repo',
          commandRunner: (command) => {
            calls.push(command);
          },
          toolChecker: (command) => {
            throw new Error(`${command} missing`);
          },
        },
      ),
    ).rejects.toThrow('go missing');
    expect(calls).toEqual([]);
  });

  it('validates config shape at load time', () => {
    const configPath = join(
      '/tmp',
      `go-artifact-publisher-${process.pid}.json`,
    );
    writeFileSync(configPath, JSON.stringify({ projectRoot: 'apps/my-cli' }));

    expect(() => readGoArtifactPublisherConfig(configPath)).toThrow(
      'Go artifact publisher config is missing binary',
    );
  });

  it('loads a valid config file', () => {
    const configPath = join(
      '/tmp',
      `go-artifact-publisher-valid-${process.pid}.json`,
    );
    writeFileSync(
      configPath,
      JSON.stringify({
        projectRoot: 'apps/my-cli',
        binary: 'my-cli',
        version: '1.2.3',
        builds: [{ goos: 'linux', goarch: 'amd64' }],
      }),
    );

    expect(readGoArtifactPublisherConfig(configPath)).toMatchObject({
      projectRoot: 'apps/my-cli',
      binary: 'my-cli',
    });
    expect(readFileSync(configPath, 'utf-8')).toContain('apps/my-cli');
  });

  it('parses CLI flags and honors Nx release dry-run environment', () => {
    expect(
      createCliRunOptions(
        ['node', 'script', '--config', 'release.json', '--verbose'],
        { NX_DRY_RUN: 'true' },
      ),
    ).toEqual({
      configPath: 'release.json',
      dryRun: true,
      verbose: true,
      skipUpload: false,
      useLocalReplaces: false,
    });
    expect(
      createCliRunOptions(
        ['node', 'script', '--config=release.json', '--skip-upload'],
        {},
      ),
    ).toEqual({
      configPath: 'release.json',
      dryRun: false,
      verbose: false,
      skipUpload: true,
      useLocalReplaces: false,
    });
    expect(
      createCliRunOptions(
        [
          'node',
          'script',
          '--config=release.json',
          '--registry=http://localhost:4873',
          '--dryRun=true',
          '--tag=next',
          '--access=public',
          '--skipUpload',
          '--provenance=true',
        ],
        {},
      ),
    ).toEqual({
      configPath: 'release.json',
      dryRun: true,
      verbose: false,
      skipUpload: true,
      useLocalReplaces: false,
    });
  });

  it('resolves absolute config paths without making them cwd-relative', () => {
    expect(resolveConfigPath('/repo', '/tmp/release.json')).toBe(
      '/tmp/release.json',
    );
    expect(resolveConfigPath('/repo', 'apps/my-cli/release.json')).toBe(
      '/repo/apps/my-cli/release.json',
    );
  });

  it('applies the CLI skip-upload override without changing other config', () => {
    expect(
      applyCliOverrides(
        {
          projectRoot: 'apps/my-cli',
          binary: 'my-cli',
          version: '1.2.3',
          builds: [{ goos: 'linux', goarch: 'amd64' }],
          artifactStore: {
            provider: 'github',
            releaseTag: 'cli-v{version}',
          },
        },
        { skipUpload: true },
      ),
    ).toMatchObject({
      projectRoot: 'apps/my-cli',
      artifactStore: {
        provider: 'none',
      },
    });
  });

  it('keeps the checked-in MoltNet CLI artifact config aligned with platform packages', () => {
    const config = readGoArtifactPublisherConfig(
      join(workspaceRoot, 'apps/moltnet-cli/nx-release-artifacts.json'),
    );
    const packageJson = readJsonFile<{ version: string }>(
      join(workspaceRoot, 'packages/cli/package.json'),
    );
    const plan = createGoArtifactReleasePlan(config, {
      cwd: workspaceRoot,
      gitShortCommit: 'abc12345',
    });

    expect(plan.buildSteps.map((step) => step.archivePath)).toEqual([
      join(
        workspaceRoot,
        `apps/moltnet-cli/dist/nx-release/moltnet_${packageJson.version}_linux_amd64.tar.gz`,
      ),
      join(
        workspaceRoot,
        `apps/moltnet-cli/dist/nx-release/moltnet_${packageJson.version}_linux_arm64.tar.gz`,
      ),
      join(
        workspaceRoot,
        `apps/moltnet-cli/dist/nx-release/moltnet_${packageJson.version}_darwin_amd64.tar.gz`,
      ),
      join(
        workspaceRoot,
        `apps/moltnet-cli/dist/nx-release/moltnet_${packageJson.version}_darwin_arm64.tar.gz`,
      ),
      join(
        workspaceRoot,
        `apps/moltnet-cli/dist/nx-release/moltnet_${packageJson.version}_windows_amd64.zip`,
      ),
      join(
        workspaceRoot,
        `apps/moltnet-cli/dist/nx-release/moltnet_${packageJson.version}_windows_arm64.zip`,
      ),
    ]);
    expect(plan.buildSteps.map((step) => step.packageBinaryPath)).toEqual([
      join(workspaceRoot, 'packages/cli/npm/linux-x64/bin/moltnet'),
      join(workspaceRoot, 'packages/cli/npm/linux-arm64/bin/moltnet'),
      join(workspaceRoot, 'packages/cli/npm/darwin-x64/bin/moltnet'),
      join(workspaceRoot, 'packages/cli/npm/darwin-arm64/bin/moltnet'),
      join(workspaceRoot, 'packages/cli/npm/win32-x64/bin/moltnet.exe'),
      join(workspaceRoot, 'packages/cli/npm/win32-arm64/bin/moltnet.exe'),
    ]);
    expect(plan.checksumFile).toBe(
      join(workspaceRoot, 'apps/moltnet-cli/dist/nx-release/checksums.txt'),
    );
  });

  it('keeps platform package publish targets ordered after moltnet-cli artifacts', () => {
    const platformPackages = [
      'darwin-arm64',
      'darwin-x64',
      'linux-arm64',
      'linux-x64',
      'win32-arm64',
      'win32-x64',
    ];

    for (const platformPackage of platformPackages) {
      expect(
        readJsonFile<{
          nx?: {
            implicitDependencies?: string[];
          };
        }>(
          join(
            workspaceRoot,
            'packages/cli/npm',
            platformPackage,
            'package.json',
          ),
        ).nx?.implicitDependencies,
      ).toEqual(['moltnet-cli']);
    }
  });
});
