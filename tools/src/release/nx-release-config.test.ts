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
      ['tools/release/docker-preversion.mjs'],
      {
        cwd: workspaceRoot,
        encoding: 'utf8',
        env: childEnv,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(
      'Skipping Docker pre-version build during nx release dry-run.\n',
    );
  });
});
