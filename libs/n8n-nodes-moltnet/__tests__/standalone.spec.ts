import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const packageRoot = resolve(__dirname, '..');
const repositoryRoot = resolve(packageRoot, '../..');
const generator = resolve(packageRoot, 'scripts/build-standalone.mjs');
const sourceRef = 'n8n-nodes-moltnet-v0.6.0';
const sourceSha = 'a'.repeat(40);
const temporaryDirectories: string[] = [];

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'moltnet-n8n-standalone-'));
  temporaryDirectories.push(directory);
  return directory;
}

function build(output: string) {
  execFileSync(
    process.execPath,
    [generator, output, '--source-ref', sourceRef, '--source-sha', sourceSha],
    { cwd: packageRoot, stdio: 'pipe' },
  );
}

function inventory(root: string) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return {
        digest: createHash('sha256').update(readFileSync(path)).digest('hex'),
        path: relative(root, path),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('standalone repository projection', () => {
  it('generates the starter-compatible root deterministically', () => {
    const first = join(temporaryDirectory(), 'first');
    const second = join(temporaryDirectory(), 'second');

    build(first);
    build(second);

    expect(inventory(first)).toEqual(inventory(second));
    expect(readFileSync(join(first, 'README.md'), 'utf8')).toContain(
      'This repository is generated',
    );
    expect(readFileSync(join(first, 'SOURCE.md'), 'utf8')).toContain(sourceSha);
    expect(
      readFileSync(join(first, 'credentials/MoltNetAgentApi.credentials.ts')),
    ).toEqual(
      readFileSync(
        join(packageRoot, 'credentials/MoltNetAgentApi.credentials.ts'),
      ),
    );
    expect(
      readFileSync(join(first, 'nodes/MoltNet/ApiBindings.ts'), 'utf8'),
    ).toContain('../../vendor/moltnet-api-bindings/api-bindings.js');
    expect(() =>
      readFileSync(join(first, '.github/workflows/ci.yml')),
    ).toThrow();
    expect(() => readFileSync(join(first, 'package-lock.json'))).toThrow();
    expect(() =>
      readFileSync(join(first, 'scripts/publish-exact.mjs')),
    ).toThrow();
    expect(() =>
      readFileSync(
        join(
          first,
          'vendor/moltnet-api-bindings/generated-api-bindings/client/plugin.ts',
        ),
      ),
    ).toThrow();
    expect(
      readFileSync(join(first, 'scripts/check-pack-shared.ts'), 'utf8'),
    ).toContain('checkNoMissingRelativeJsImports');
  });

  it('emits a standalone npm manifest without owning its npm lockfile', () => {
    const output = join(temporaryDirectory(), 'repository');
    build(output);

    const manifest = JSON.parse(
      readFileSync(join(output, 'package.json'), 'utf8'),
    );

    expect(manifest.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/getlarge/n8n-nodes-moltnet.git',
    });
    expect(manifest.nx).toBeUndefined();
    expect(manifest.devDependencies['@moltnet/api-client']).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toMatch(/(?:workspace|catalog):/u);
    expect(() => readFileSync(join(output, 'package-lock.json'))).toThrow();
  });

  it('refuses to replace a non-empty output directory', () => {
    const output = temporaryDirectory();
    writeFileSync(join(output, 'owned-by-someone-else'), 'preserve me');

    const result = spawnSync(
      process.execPath,
      [generator, output, '--source-ref', sourceRef, '--source-sha', sourceSha],
      { cwd: packageRoot, encoding: 'utf8' },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('is not empty');
    expect(readFileSync(join(output, 'owned-by-someone-else'), 'utf8')).toBe(
      'preserve me',
    );
  });

  it('hands releases off through a standalone pull request', () => {
    const workflow = readFileSync(
      join(repositoryRoot, '.github/workflows/release.yml'),
      'utf8',
    );
    const proposal = workflow.match(
      / {2}propose-n8n-nodes-moltnet:[\s\S]*?(?=\n {2}promote-n8n-nodes-moltnet:)/,
    )?.[0];

    expect(proposal).toContain('timeout-minutes: 20');
    expect(proposal).toContain('permission-pull-requests: write');
    expect(proposal).not.toContain('permission-actions: write');
    expect(proposal).not.toContain('permission-workflows: write');
    expect(proposal).toContain('gh pr create');
    expect(proposal).toContain('--force-with-lease');
    expect(proposal).not.toContain('gh run watch');
    expect(workflow).toMatch(
      /promote-n8n-nodes-moltnet:[\s\S]*needs\.propose-n8n-nodes-moltnet\.result == 'success'/,
    );
  });
});
