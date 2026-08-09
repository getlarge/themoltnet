import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const nxConfig = JSON.parse(
  readFileSync(new URL('../../../nx.json', import.meta.url), 'utf8'),
);
const workflow = readFileSync(
  new URL('../../../.github/workflows/release.yml', import.meta.url),
  'utf8',
);
const releasePleaseConfig = JSON.parse(
  readFileSync(
    new URL('../../../release-please-config.json', import.meta.url),
    'utf8',
  ),
);
const dockerProjects = [
  { name: '@moltnet/console', root: 'apps/console' },
  { name: '@moltnet/database', root: 'libs/database' },
  { name: '@moltnet/landing', root: 'apps/landing' },
  { name: '@moltnet/mcp-host', root: 'apps/mcp-host' },
  { name: '@moltnet/mcp-server', root: 'apps/mcp-server' },
  { name: '@moltnet/rest-api', root: 'apps/rest-api' },
  {
    name: 'otel-custom-collector',
    root: 'infra/otel/custom-collector',
  },
] as const;

function runNode(script: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
  delete childEnv.FORCE_COLOR;
  delete childEnv.NO_COLOR;

  return spawnSync(process.execPath, [script, ...args], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    env: childEnv,
  });
}

describe('Nx release configuration', () => {
  it('keeps independent projects in stable artifact-type groups', () => {
    expect(nxConfig.release.groups['npm-packages']).toMatchObject({
      projectsRelationship: 'independent',
      releaseTag: {
        pattern: '{projectName}-v{version}',
      },
    });

    expect(nxConfig.release.groups['docker-images']).toMatchObject({
      docker: {
        groupPreVersionCommand: 'node tools/release/docker-preversion.mjs',
      },
      projectsRelationship: 'independent',
      releaseTag: {
        pattern: '{projectName}-v{version}',
      },
    });

    expect(
      nxConfig.release.groups['npm-packages'].projects.length,
    ).toBeGreaterThan(1);
    expect(
      nxConfig.release.groups['docker-images'].projects.length,
    ).toBeGreaterThan(1);
  });

  it('propagates dry-run mode to Docker release actions in CI', () => {
    expect(workflow).toContain(
      '- if: ${{ !inputs.dry-run }}\n        uses: docker/setup-buildx-action@v4',
    );
    expect(workflow).toContain(
      'NX_DRY_RUN=true pnpm exec nx release --dry-run',
    );
  });

  it('publishes every Nx Docker project through Release Please', () => {
    expect(nxConfig.release.groups['docker-images'].projects).toEqual(
      dockerProjects.map(({ name }) => name),
    );

    for (const { name, root } of dockerProjects) {
      expect(releasePleaseConfig.packages[root]).toBeDefined();

      const packageConfig = JSON.parse(
        readFileSync(
          new URL(`../../../${root}/package.json`, import.meta.url),
          'utf8',
        ),
      );
      const dockerBuildTarget = packageConfig.nx.targets['docker:build'];
      const configurations = dockerBuildTarget.configurations;

      expect(dockerBuildTarget.options.command).toContain(
        '--project {projectName}',
      );
      expect(configurations.ci.command).toContain('--project {projectName}');
      expect(configurations.ci.command).toContain('--platform linux/amd64');
      expect(configurations.release.command).toContain(
        '--project {projectName}',
      );
      expect(configurations.release.command).toContain(
        '--platform linux/amd64,linux/arm64',
      );
      expect(configurations.release.command).toContain(
        '${NX_DOCKER_RELEASE_TAG:',
      );
      expect(workflow).toContain(`"project":"${name}"`);
    }

    expect(workflow).toContain('docker/setup-qemu-action@v4');
    expect(workflow).toContain(
      'node tools/release/resolve-docker-release-matrix.mjs',
    );
    expect(workflow).not.toContain('resolve-docker-images:');
    expect(workflow).toContain(
      'docker-has-releases: ${{ steps.resolve-docker.outputs.has-releases }}',
    );
    expect(workflow).toContain(
      'docker-matrix: ${{ steps.resolve-docker.outputs.matrix }}',
    );
    expect(workflow).toContain(
      "if: ${{ always() && needs.resolve-publish.outputs.docker-has-releases == 'true' && !failure() && !cancelled() }}",
    );
    expect(workflow).toContain('--configuration=release');
    expect(workflow).toContain(
      'gh release edit "$NX_DOCKER_RELEASE_GIT_TAG" --draft=false',
    );
  });

  it('builds the collector release with the latest Go 1.25 patch', () => {
    expect(workflow).toContain(
      `      - uses: actions/setup-go@v6
        if: \${{ matrix.project == 'otel-custom-collector' }}
        with:
          go-version: '1.25'
          check-latest: true
          cache: true`,
    );
  });

  it('can republish failed Docker releases from their existing drafts', () => {
    expect(workflow).toContain(
      'agent-daemon, console, database, landing, mcp-host, mcp-server, rest-api, otel-custom-collector',
    );
    expect(workflow).toContain(
      'resolve_docker "otel-custom-collector" "$RP_OTEL_COLLECTOR_CREATED" "$RP_OTEL_COLLECTOR_TAG" "$RP_OTEL_COLLECTOR_VERSION" "otel-collector"',
    );
    expect(workflow).toContain(
      '"released":"${{ steps.resolve.outputs.docker-otel-custom-collector }}"',
    );
    expect(workflow).not.toContain(
      `id: resolve-docker
        if: \${{ github.event_name == 'push' }}`,
    );
  });

  it('resolves only released Docker projects with exact SemVer tags', () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), 'moltnet-docker-release-'),
    );
    const outputPath = join(temporaryDirectory, 'github-output');
    writeFileSync(outputPath, '');

    try {
      const result = runNode(
        'tools/release/resolve-docker-release-matrix.mjs',
        [],
        {
          GITHUB_OUTPUT: outputPath,
          MOLTNET_DOCKER_RELEASES_JSON: JSON.stringify([
            {
              project: '@moltnet/console',
              released: 'false',
              tag: '',
              version: '',
            },
            {
              project: '@moltnet/rest-api',
              released: 'true',
              tag: 'rest-api-v0.41.0',
              version: '0.41.0',
            },
          ]),
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(readFileSync(outputPath, 'utf8')).toBe(
        'matrix={"include":[{"project":"@moltnet/rest-api","tag":"rest-api-v0.41.0","version":"0.41.0"}]}\nhas-releases=true\n',
      );
    } finally {
      rmSync(temporaryDirectory, { recursive: true });
    }
  });

  it('keeps release builds multi-platform without moving ci-main', () => {
    const result = runNode(
      'tools/docker-build.mjs',
      [
        '--project',
        '@moltnet/rest-api',
        '--push',
        '--tag',
        '0.41.0',
        '--no-cache-to',
        '--dry-run',
      ],
      {
        GITHUB_REF: 'refs/heads/main',
        GITHUB_SHA: '0123456789abcdef',
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(
      'clean tag  : ghcr.io/getlarge/themoltnet/rest-api:0.41.0',
    );
    expect(result.stdout).toContain('--platform linux/amd64,linux/arm64');
    expect(result.stdout).not.toContain('ci-main');
  });

  it('uses the Docker host architecture for local image loads', () => {
    const result = runNode('tools/docker-build.mjs', [
      '--project',
      '@moltnet/console',
      '--dry-run',
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('platform   : docker-host');
    expect(result.stdout).not.toContain('--platform');
    expect(result.stdout).toContain('--load');
  });

  it('rejects multi-platform image loads into the local daemon', () => {
    const result = runNode('tools/docker-build.mjs', [
      '--project',
      '@moltnet/console',
      '--platform',
      'linux/amd64,linux/arm64',
      '--dry-run',
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'docker buildx --load supports only one platform',
    );
  });

  it('keeps the Docker pre-version helper side-effect free in dry-run mode', () => {
    const result = runNode('tools/release/docker-preversion.mjs', [], {
      NX_DRY_RUN: 'true',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(
      'Skipping Docker pre-version build during nx release dry-run.\n',
    );
  });
});
