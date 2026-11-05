import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

test('daemon callers scope read-only App tokens to the shared release lookup', () => {
  const mention = parse(
    readFileSync(
      resolve(root, '.github/workflows/moltnet-mention.yml'),
      'utf8',
    ),
  );
  for (const [steps, ids, expectedToken] of [
    [
      workflow.jobs.triage.steps,
      ['extract', 'classify'],
      '${{ steps.release-token.outputs.token }}',
    ],
    [
      mention.jobs.dispatch.steps,
      ['agent'],
      '${{ steps.release-token.outputs.token || github.token }}',
    ],
  ]) {
    const token = steps.find((step) => step.id === 'release-token');
    assert.equal(
      token.with.repositories,
      '${{ github.event.repository.name }}',
    );
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(token.with).filter(([key]) =>
          key.startsWith('permission-'),
        ),
      ),
      { 'permission-contents': 'read' },
    );
    assert.equal(
      steps.some((step) => step.id === 'daemon-release'),
      false,
    );
    for (const id of ids) {
      const task = steps.find((step) => step.id === id);
      assert.equal(task.with['github-release-token'], expectedToken);
      assert.equal(task.with['daemon-version'], undefined);
      assert.ok(steps.indexOf(token) < steps.indexOf(task));
    }
    for (const step of steps) {
      assert.ok(
        !JSON.stringify(step.env ?? {}).includes('release-token.outputs.token'),
      );
    }
  }
  assert.equal(
    workflow.jobs.triage.steps.find((step) => step.id === 'release-token').if,
    "steps.prepare.outputs.eligible == 'true'",
  );
  assert.equal(
    mention.jobs.dispatch.steps.find((step) => step.id === 'release-token').if,
    "vars.MOLTNET_GITHUB_APP_ID != ''",
  );
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
