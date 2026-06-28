import { describe, expect, it } from 'vitest';

import {
  afterAllProjectsVersioned,
  createGoReleaseValidationCommands,
  escapeGoProxyPath,
  findGoRequireVersion,
  normalizeGoModuleVersion,
  resolveGoProxyUrl,
  shouldRunGoReleaseValidation,
  updateGoRequireVersions,
} from './go-version-actions';

describe('go version actions helpers', () => {
  it('reads versions from single-line and block require declarations', () => {
    const goMod = `module github.com/getlarge/themoltnet/apps/moltnet-cli

go 1.24

require github.com/getlarge/themoltnet/libs/moltnet-api-client v0.2.0

require (
	github.com/getlarge/themoltnet/libs/dspy-adapters v0.3.0
	github.com/other/module v1.0.0
)
`;

    expect(
      findGoRequireVersion(
        goMod,
        'github.com/getlarge/themoltnet/libs/moltnet-api-client',
      ),
    ).toBe('v0.2.0');
    expect(
      findGoRequireVersion(
        goMod,
        'github.com/getlarge/themoltnet/libs/dspy-adapters',
      ),
    ).toBe('v0.3.0');
  });

  it('updates only matching require entries and preserves comments', () => {
    const goMod = `module github.com/getlarge/themoltnet/apps/moltnet-cli

go 1.24

require (
	github.com/getlarge/themoltnet/libs/moltnet-api-client v0.2.0 // direct
	github.com/other/module v1.0.0
)

replace github.com/getlarge/themoltnet/libs/moltnet-api-client => ../../libs/moltnet-api-client
`;

    const result = updateGoRequireVersions(goMod, {
      'github.com/getlarge/themoltnet/libs/moltnet-api-client': '0.3.0',
      'github.com/getlarge/themoltnet/libs/missing': '0.4.0',
    });

    expect(result.updatedModules).toEqual([
      'github.com/getlarge/themoltnet/libs/moltnet-api-client@v0.3.0',
    ]);
    expect(result.goMod).toContain(
      'github.com/getlarge/themoltnet/libs/moltnet-api-client v0.3.0 // direct',
    );
    expect(result.goMod).toContain('github.com/other/module v1.0.0');
    expect(result.goMod).toContain(
      'replace github.com/getlarge/themoltnet/libs/moltnet-api-client => ../../libs/moltnet-api-client',
    );
    expect(result.goMod).not.toContain(
      'github.com/getlarge/themoltnet/libs/missing',
    );
  });

  it('normalizes dependency versions to Go module v-prefixed semver', () => {
    const result = updateGoRequireVersions(
      'require github.com/getlarge/themoltnet/libs/moltnet-api-client v0.2.0\n',
      {
        'github.com/getlarge/themoltnet/libs/moltnet-api-client': 'v0.3.0',
      },
    );

    expect(result.goMod).toBe(
      'require github.com/getlarge/themoltnet/libs/moltnet-api-client v0.3.0\n',
    );
  });

  it('escapes module paths for Go proxy requests', () => {
    expect(escapeGoProxyPath('github.com/Acme/FooBar')).toBe(
      'github.com/!acme/!foo!bar',
    );
  });

  it('normalizes Go module versions for Nx semver calculations', () => {
    expect(normalizeGoModuleVersion('v1.2.3')).toBe('1.2.3');
    expect(normalizeGoModuleVersion('1.2.3')).toBe('1.2.3');
  });

  it('resolves Go proxy URL from metadata or GOPROXY', () => {
    const originalGoProxy = process.env.GOPROXY;
    try {
      delete process.env.GOPROXY;
      expect(resolveGoProxyUrl({})).toBe('https://proxy.golang.org');
      expect(
        resolveGoProxyUrl({
          registry: 'https://proxy.example.test/',
        }),
      ).toBe('https://proxy.example.test');

      process.env.GOPROXY = 'direct,https://proxy.internal.test,off';
      expect(resolveGoProxyUrl({})).toBe('https://proxy.internal.test');

      process.env.GOPROXY = 'direct,off';
      expect(resolveGoProxyUrl({})).toBeNull();
    } finally {
      if (originalGoProxy === undefined) {
        delete process.env.GOPROXY;
      } else {
        process.env.GOPROXY = originalGoProxy;
      }
    }
  });

  it('plans GOWORK=off release validation commands for configured roots', () => {
    expect(
      createGoReleaseValidationCommands('/repo', {
        goReleaseValidationRoots: ['apps/moltnet-cli'],
      }),
    ).toEqual([
      {
        root: 'apps/moltnet-cli',
        command: 'go',
        args: ['mod', 'tidy'],
        env: {
          GOWORK: 'off',
          GOPROXY: 'direct',
        },
        changedFiles: ['apps/moltnet-cli/go.mod', 'apps/moltnet-cli/go.sum'],
      },
      {
        root: 'apps/moltnet-cli',
        command: 'go',
        args: ['build', './...'],
        env: {
          GOWORK: 'off',
          GOPROXY: 'direct',
        },
        changedFiles: [],
      },
    ]);
  });

  it('lets the release validation GOPROXY be overridden', () => {
    const commands = createGoReleaseValidationCommands('/repo', {
      goReleaseValidationRoots: ['apps/moltnet-cli'],
      goReleaseGoproxy: 'https://proxy.golang.org,direct',
    });

    expect(commands.map((command) => command.env.GOPROXY)).toEqual([
      'https://proxy.golang.org,direct',
      'https://proxy.golang.org,direct',
    ]);
  });

  it('skips release validation for docker-only release groups', () => {
    expect(
      shouldRunGoReleaseValidation({}, [
        'nx',
        'release',
        'version',
        '--groups',
        'docker-images',
      ]),
    ).toBe(false);
    expect(
      createGoReleaseValidationCommands(
        '/repo',
        {
          goReleaseValidationRoots: ['apps/moltnet-cli'],
        },
        ['nx', 'release', 'version', '--groups=docker-images'],
      ),
    ).toEqual([]);
  });

  it('runs release validation for go and cli release selections', () => {
    expect(
      shouldRunGoReleaseValidation({}, [
        'nx',
        'release',
        'version',
        '--groups',
        'go-modules,cli',
      ]),
    ).toBe(true);
    expect(
      shouldRunGoReleaseValidation({}, [
        'nx',
        'release',
        'version',
        '--projects=moltnet-cli',
      ]),
    ).toBe(true);
  });

  it('does not run Go release validation during dry-run', async () => {
    const result = await afterAllProjectsVersioned('/repo', {
      dryRun: true,
      rootVersionActionsOptions: {
        goReleaseValidationRoots: ['apps/moltnet-cli'],
      },
    });

    expect(result).toEqual({ changedFiles: [], deletedFiles: [] });
  });
});
