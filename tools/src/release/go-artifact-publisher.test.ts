import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createGoArtifactReleasePlan,
  readGoArtifactPublisherConfig,
} from './go-artifact-publisher';

function writePackageJson(root: string, version = '1.2.3') {
  mkdirSync(join(root, 'packages/cli'), { recursive: true });
  writeFileSync(
    join(root, 'packages/cli/package.json'),
    JSON.stringify({ version }),
  );
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
});
