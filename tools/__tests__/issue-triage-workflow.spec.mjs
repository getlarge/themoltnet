import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { test } from 'vitest';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '../../');
const path = '.github/workflows/issue-triage.yml';
const source = readFileSync(resolve(root, path), 'utf8');
const workflow = parse(source);

test('triage keeps queued jobs without cancelling earlier requests', () => {
  for (const name of ['invite', 'triage']) {
    assert.deepEqual(workflow.jobs[name].concurrency, {
      group: 'issue-triage-pilot',
      queue: 'max',
      'cancel-in-progress': false,
    });
  }
});

test('receipt upload follows successful publication and is bounded', () => {
  const steps = workflow.jobs.triage.steps;
  const publish = steps.findIndex((step) => step.id === 'publish');
  const upload = steps.findIndex(
    (step) => step.name === 'Retain triage receipt',
  );
  assert.ok(publish >= 0 && upload > publish);
  assert.equal(steps[upload].if, "steps.publish.outputs.receipt != ''");
  assert.equal(steps[upload].with.path, '${{ steps.publish.outputs.receipt }}');
  assert.equal(steps[upload].with['if-no-files-found'], 'error');
  assert.equal(steps[upload].with['retention-days'], 14);
  assert.ok(steps[upload].with.name.includes('github.run_attempt'));
});

test('release lookup has a separate read-only App token and pins both tasks', () => {
  const steps = workflow.jobs.triage.steps;
  const token = steps.find((step) => step.id === 'release-token');
  const lookup = steps.find((step) => step.id === 'daemon-release');
  assert.equal(token.if, "steps.prepare.outputs.eligible == 'true'");
  assert.equal(lookup.if, token.if);
  assert.equal(token.with.repositories, '${{ github.event.repository.name }}');
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(token.with).filter(([key]) =>
        key.startsWith('permission-'),
      ),
    ),
    { 'permission-contents': 'read' },
  );
  assert.deepEqual(lookup.env, {
    GH_TOKEN: '${{ steps.release-token.outputs.token }}',
  });
  for (const id of ['extract', 'classify']) {
    const task = steps.find((step) => step.id === id);
    assert.equal(
      task.with['daemon-version'],
      '${{ steps.daemon-release.outputs.version }}',
    );
    assert.ok(steps.indexOf(token) < steps.indexOf(lookup));
    assert.ok(steps.indexOf(lookup) < steps.indexOf(task));
    assert.equal(task.env.GH_TOKEN, undefined);
  }
});

function resolveRelease(pages, status = 0) {
  const dir = mkdtempSync(resolve(tmpdir(), 'triage-release-'));
  const output = resolve(dir, 'output');
  const calls = resolve(dir, 'calls');
  try {
    writeFileSync(output, '');
    writeFileSync(calls, '');
    pages.forEach((page, i) =>
      writeFileSync(resolve(dir, `page-${i + 1}.json`), JSON.stringify(page)),
    );
    writeFileSync(
      resolve(dir, 'gh'),
      `#!/bin/sh
set -eu
[ "$1 $2 $3" = 'api --hostname github.com' ]
printf '%s\\n' "$4" >> "$FIXTURE_DIR/calls"
if [ "$FIXTURE_STATUS" != 0 ]; then exit "$FIXTURE_STATUS"; fi
page=\${4##*page=}
cat "$FIXTURE_DIR/page-$page.json"
`,
      { mode: 0o755 },
    );
    const result = spawnSync(
      'bash',
      [
        '-c',
        workflow.jobs.triage.steps.find((step) => step.id === 'daemon-release')
          .run,
      ],
      {
        encoding: 'utf8',
        env: {
          PATH: `${dir}:${process.env.PATH}`,
          GITHUB_OUTPUT: output,
          FIXTURE_DIR: dir,
          FIXTURE_STATUS: String(status),
        },
      },
    );
    return {
      ...result,
      output: readFileSync(output, 'utf8'),
      calls: readFileSync(calls, 'utf8').trim().split('\n'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const release = (tag_name, overrides = {}) => ({
  tag_name,
  draft: false,
  prerelease: false,
  ...overrides,
});

test('release lookup skips drafts, prereleases and unrelated or unsafe tags', () => {
  const result = resolveRelease([
    [
      release('agent-daemon-v9.0.0', { draft: true }),
      release('agent-daemon-v8.0.0', { prerelease: true }),
      release('cli-v3.23.0'),
      release('agent-daemon-v7.0.0-rc.1'),
      release('agent-daemon-v6.0.0\ninjected=value'),
      release('agent-daemon-v0.74.3'),
      release('agent-daemon-v0.74.2'),
    ],
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'version=0.74.3\n');
  assert.deepEqual(result.calls, [
    'repos/getlarge/themoltnet/releases?per_page=100&page=1',
  ]);
});

test('release lookup follows pages until it finds a published daemon', () => {
  const result = resolveRelease([
    Array.from({ length: 100 }, () => release('cli-v3.23.0')),
    [release('agent-daemon-v0.74.3')],
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'version=0.74.3\n');
  assert.deepEqual(result.calls, [
    'repos/getlarge/themoltnet/releases?per_page=100&page=1',
    'repos/getlarge/themoltnet/releases?per_page=100&page=2',
  ]);
});

test('release lookup fails without emitting a version on API error or no match', () => {
  for (const result of [resolveRelease([[]]), resolveRelease([[]], 1)]) {
    assert.notEqual(result.status, 0);
    assert.equal(result.output, '');
    assert.equal(result.calls.length, 1);
  }
});

test('actionlint compatibility exception still rejects other concurrency keys', () => {
  const result = spawnSync(
    resolve(root, 'node_modules/.bin/github-actionlint'),
    ['-shellcheck=', '-pyflakes=', '-stdin-filename', path, '-'],
    {
      cwd: root,
      encoding: 'utf8',
      input: source.replaceAll('queue: max', 'queues: max'),
    },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout + result.stderr, /unexpected key "queues"/);
});
