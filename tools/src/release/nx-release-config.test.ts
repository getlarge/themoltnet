import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

const npmReleaseGroups = {
  'agent-daemon': '@themoltnet/agent-daemon',
  'agent-runtime': '@themoltnet/agent-runtime',
  ctap: '@themoltnet/ctap',
  'design-system': '@themoltnet/design-system',
  'github-agent': '@themoltnet/github-agent',
  legreffier: '@themoltnet/legreffier',
  'node-red-contrib-core': '@themoltnet/node-red-contrib-core',
  'node-red-theme': '@themoltnet/node-red-theme',
  'pi-extension': '@themoltnet/pi-extension',
  sdk: '@themoltnet/sdk',
  'yubikey-preview-sign': '@themoltnet/yubikey-preview-sign',
};

const dockerReleaseGroups = {
  console: '@moltnet/console',
  'db-migrate': '@moltnet/database',
  landing: '@moltnet/landing',
  'mcp-host': '@moltnet/mcp-host',
  'mcp-server': '@moltnet/mcp-server',
  'rest-api': '@moltnet/rest-api',
};

describe('Nx release configuration', () => {
  it('preserves the existing public npm tag prefixes', () => {
    for (const [groupName, projectName] of Object.entries(npmReleaseGroups)) {
      expect(nxConfig.release.groups[groupName]).toMatchObject({
        projects: [projectName],
        projectsRelationship: 'independent',
        releaseTag: {
          pattern: '{releaseGroupName}-v{version}',
        },
      });
    }
  });

  it('maps every Docker tag prefix to one explicit project build', () => {
    for (const [groupName, projectName] of Object.entries(
      dockerReleaseGroups,
    )) {
      expect(nxConfig.release.groups[groupName]).toMatchObject({
        docker: {
          groupPreVersionCommand: `node tools/release/docker-preversion.mjs --projects=${projectName}`,
        },
        projects: [projectName],
        projectsRelationship: 'independent',
        releaseTag: {
          pattern: '{releaseGroupName}-v{version}',
        },
      });
    }
  });

  it('does not derive public tags from scoped project names', () => {
    const scopedGroups = [
      ...Object.keys(npmReleaseGroups),
      ...Object.keys(dockerReleaseGroups),
    ];

    for (const groupName of scopedGroups) {
      expect(
        nxConfig.release.groups[groupName].releaseTag.pattern,
      ).not.toContain('{projectName}');
    }

    expect(nxConfig.release.groups['npm-packages']).toBeUndefined();
    expect(nxConfig.release.groups['docker-images']).toBeUndefined();
  });

  it('propagates dry-run mode to Docker release actions in CI', () => {
    expect(workflow).toContain(
      '- if: ${{ !inputs.dry-run }}\n        uses: docker/setup-buildx-action@v3',
    );
    expect(workflow).toContain(
      'NX_DRY_RUN=true pnpm exec nx release --dry-run',
    );
  });

  it('keeps the Docker pre-version helper side-effect free in dry-run mode', () => {
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      NX_DRY_RUN: 'true',
    };
    delete childEnv.FORCE_COLOR;
    delete childEnv.NO_COLOR;

    const result = spawnSync(
      process.execPath,
      ['tools/release/docker-preversion.mjs', '--projects=@moltnet/rest-api'],
      {
        cwd: workspaceRoot,
        encoding: 'utf8',
        env: childEnv,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(
      'Skipping Docker pre-version build for @moltnet/rest-api during nx release dry-run.\n',
    );
  });
});
