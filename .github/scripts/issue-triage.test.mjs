import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  buildSpec,
  buildClassifierSpec,
  categoryLabel,
  invitationAction,
  parseClassification,
  parseVerdict,
  renderComment,
  CRITERIA,
  issueContentDigest,
  validateAcceptedTask,
} from './issue-triage.mjs';

const issue = {
  number: 42,
  state: 'open',
  title: 'Add task status',
  body: 'Done when: status appears. Context: apps/console/src/. No dependencies.',
  labels: [{ name: 'needs-spec' }],
};

test('builds a bounded task from an eligible issue', () => {
  const spec = buildSpec(issue, 'getlarge/themoltnet', false);
  assert.equal(spec.taskType, 'freeform');
  assert.deepEqual(spec.tags, [
    'review:issue-triage',
    'stage:extract',
    'repo:getlarge/themoltnet',
    'issue:42',
  ]);
  assert.equal(
    spec.input.outputContract.schema.properties.criteria.minItems,
    5,
  );
  assert.deepEqual(
    spec.input.outputContract.schema.properties.criteria.items.required,
    ['id', 'passed', 'reason', 'evidence'],
  );
  assert.match(spec.input.brief, /apps\/console\/src/);
  assert.equal(
    buildSpec({ ...issue, state: 'closed' }, 'getlarge/themoltnet', false),
    null,
  );
  assert.equal(
    buildSpec({ ...issue, labels: [] }, 'getlarge/themoltnet', true),
    null,
  );
});

test('rejects missing and duplicate criterion results before writing', () => {
  const criteria = CRITERIA.map((id) => ({
    id,
    passed: true,
    reason: 'Present',
    evidence: ['Done when: status appears.'],
  }));
  assert.equal(parseVerdict({ result: { criteria } }, issue).length, 5);
  assert.throws(() =>
    parseVerdict({ result: { criteria: criteria.slice(1) } }, issue),
  );
  assert.throws(() =>
    parseVerdict(
      { result: { criteria: [...criteria.slice(1), criteria[1]] } },
      issue,
    ),
  );
  assert.throws(() =>
    parseVerdict(
      {
        result: {
          criteria: [{ ...criteria[0], passed: 'yes' }, ...criteria.slice(1)],
        },
      },
      issue,
    ),
  );
  const sanitized = parseVerdict(
    {
      result: {
        criteria: [
          {
            ...criteria[0],
            evidence: ['Done when: status ...', 'Done when: status appears.'],
            unexpected: 'Unbounded model data must not enter the receipt',
          },
          ...criteria.slice(1),
        ],
      },
    },
    issue,
  );
  assert.deepEqual(sanitized[0].evidence, ['Done when: status appears.']);
  assert.equal(sanitized[0].unexpected, undefined);
  assert.deepEqual(
    buildClassifierSpec(issue, 'getlarge/themoltnet', 'correlation', sanitized)
      .input.state.evidence['acceptance-criteria'],
    ['Done when: status appears.'],
  );
});

test('chains validated extraction into a standalone classifier task', () => {
  const criteria = CRITERIA.map((id) => ({
    id,
    passed: true,
    reason: 'Present',
    evidence: ['Done when: status appears.'],
  }));
  const spec = buildClassifierSpec(
    issue,
    'getlarge/themoltnet',
    'correlation',
    criteria,
  );
  assert.equal(spec.taskType, 'classify');
  assert.deepEqual(spec.tags, [
    'review:issue-triage',
    'stage:classify',
    'repo:getlarge/themoltnet',
    'issue:42',
  ]);
  assert.equal(spec.correlationId, 'correlation');
  assert.deepEqual(spec.input.state.evidence['context-files'], [
    'Done when: status appears.',
  ]);
  assert.deepEqual(Object.keys(spec.input.questions), [
    'category',
    ...CRITERIA,
  ]);
  assert.equal(spec.input.questions['scoped-effort'].type, 'bool');
});

test('validates all classifier answers before publishing', () => {
  const answers = {
    category: {
      type: 'choice',
      choice: 'feature',
      probabilities: { bug: 0.1, feature: 0.8, question: 0.05, other: 0.05 },
      confidence: 0.8,
    },
    ...Object.fromEntries(
      CRITERIA.map((id) => [id, { type: 'bool', probability: 0.75 }]),
    ),
  };
  const output = {
    version: 1,
    answers,
  };
  assert.equal(parseClassification(output).category, 'feature');
  assert.throws(() =>
    parseClassification({
      ...output,
      answers: { ...answers, extra: answers['scoped-effort'] },
    }),
  );
  assert.throws(() =>
    parseClassification({
      ...output,
      answers: {
        ...answers,
        category: {
          ...answers.category,
          probabilities: { ...answers.category.probabilities, feature: 0.7 },
        },
      },
    }),
  );
  assert.throws(() =>
    parseClassification({
      ...output,
      answers: { ...answers, dependencies: { type: 'bool', probability: 2 } },
    }),
  );
});

test('labels only confident categories when no category was assigned', () => {
  const classification = {
    category: 'feature',
    probabilities: { feature: 0.9 },
  };
  assert.equal(categoryLabel(classification, []), 'enhancement');
  assert.equal(categoryLabel(classification, ['bug']), null);
  assert.equal(categoryLabel(classification, ['documentation']), 'enhancement');
  assert.equal(
    categoryLabel({ ...classification, category: 'other' }, []),
    null,
  );
  assert.equal(
    categoryLabel({ ...classification, probabilities: { feature: 0.8 } }, []),
    null,
  );
});

test('creates one invitation and only updates the bot-owned copy', () => {
  const repo = 'getlarge/themoltnet';
  const forged = {
    id: 1,
    user: { login: 'someone' },
    body: '<!-- moltnet-issue-triage-invite -->',
  };
  const create = invitationAction(issue, [forged], repo);
  assert.equal(create.method, 'POST');
  assert.equal(create.path, 'repos/getlarge/themoltnet/issues/42/comments');
  assert.match(create.body.body, /reply with `\/triage`/);
  const bot = { ...forged, id: 2, user: { login: 'legreffier[bot]' } };
  const update = invitationAction(issue, [forged, bot], repo);
  assert.equal(update.method, 'PATCH');
  assert.equal(update.path, 'repos/getlarge/themoltnet/issues/comments/2');
  assert.equal(
    invitationAction(issue, [forged, { ...bot, body: update.body.body }], repo),
    null,
  );
  assert.equal(invitationAction({ ...issue, state: 'closed' }, [], repo), null);
});

test('renders the verdict and per-criterion reasons', () => {
  const criteria = CRITERIA.map((id) => ({
    id,
    passed: true,
    reason: 'Present',
    evidence: [],
  }));
  assert.match(renderComment(criteria), /Ready for agent pickup/);
  assert.match(
    renderComment([{ ...criteria[0], passed: false }, ...criteria.slice(1)]),
    /needs more detail/,
  );
  assert.match(
    renderComment([
      { ...criteria[0], reason: '<b>@user</b>' },
      ...criteria.slice(1),
    ]),
    /&lt;b>&#64;user&lt;\/b>/,
  );
  assert.match(
    renderComment(criteria, {
      category: 'feature',
      probabilities: { feature: 0.8 },
      readiness: Object.fromEntries(CRITERIA.map((id) => [id, 0.7])),
    }),
    /No category label added/,
  );
  assert.match(
    renderComment(criteria, undefined, 'same-correlation'),
    /<!-- moltnet-correlation-id: same-correlation -->/,
  );
});

test('prepares the next task from the accepted attempt and preserves labels if classification is unavailable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'issue-triage-chain-'));
  const snapshot = {
    ...issue,
    sourceRevision: 'c'.repeat(40),
    updatedAt: '2026-10-13T10:00:00Z',
    correlationId: 'same-correlation',
  };
  const criteria = CRITERIA.map((id) => ({
    id,
    passed: true,
    reason: 'Present',
    evidence: ['Done when: status appears.'],
  }));
  const snapshotPath = join(dir, 'snapshot.json');
  const extractionPath = join(dir, 'extraction.json');
  const classifierPath = join(dir, 'classifier.json');
  const outputPath = join(dir, 'output');
  const callsPath = join(dir, 'gh-calls');
  const cliPackagesPath = join(dir, 'cli-packages');
  const bodyPath = join(dir, 'gh-body');
  writeFileSync(snapshotPath, JSON.stringify(snapshot));
  function fixture(id, spec, output) {
    return {
      task: {
        id,
        teamId: 'team-id',
        taskType: spec.taskType,
        status: 'completed',
        correlationId: snapshot.correlationId,
        inputCid: 'bafyinput',
        acceptedAttemptN: 2,
        tags: spec.tags,
        input: spec.input,
      },
      attempt: {
        taskId: id,
        attemptN: 2,
        status: 'completed',
        outputCid: 'bafyoutput',
        output,
      },
    };
  }
  const extractionFixture = fixture(
    'extract-task',
    buildSpec(issue, 'getlarge/themoltnet', false),
    { result: { criteria } },
  );
  const classifierSpec = buildClassifierSpec(
    issue,
    'getlarge/themoltnet',
    snapshot.correlationId,
    criteria,
  );
  writeFileSync(extractionPath, JSON.stringify(extractionFixture));
  writeFileSync(
    classifierPath,
    JSON.stringify(
      fixture('classifier-task', classifierSpec, { result: { criteria } }),
    ),
  );
  writeFileSync(outputPath, '');
  writeFileSync(callsPath, '');
  writeFileSync(cliPackagesPath, '');
  writeFileSync(
    join(dir, 'npx'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CLI_PACKAGES, args[1] + '\\n');
const data = JSON.parse(fs.readFileSync(args[4] === 'classifier-task' ? process.env.CLASSIFIER_FIXTURE : process.env.EXTRACTION_FIXTURE, 'utf8'));
process.stdout.write(JSON.stringify(args[3] === 'get' ? data.task : data.attempt));
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(dir, 'gh'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GH_CALLS, args.join(' ') + '\\n');
if (args[2] === 'GET') {
  process.stdout.write(process.env.POST_WRITE_ISSUE && fs.existsSync(process.env.GH_BODY) ? process.env.POST_WRITE_ISSUE : process.env.ISSUE_FIXTURE);
} else if (args[2] === 'POST' && args[3].endsWith('/comments')) {
  fs.writeFileSync(process.env.GH_BODY, fs.readFileSync(0, 'utf8'));
}
`,
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    SNAPSHOT: snapshotPath,
    EXTRACTION_TASK_ID: 'extract-task',
    EXTRACTION_CORRELATION_ID: snapshot.correlationId,
    CLASSIFIER_TASK_ID: 'classifier-task',
    CLASSIFIER_CORRELATION_ID: snapshot.correlationId,
    EXTRACTION_FIXTURE: extractionPath,
    CLASSIFIER_FIXTURE: classifierPath,
    GH_CALLS: callsPath,
    CLI_PACKAGES: cliPackagesPath,
    MOLTNET_CLI_PACKAGE: '',
    MOLTNET_CLI_VERSION: readFileSync(
      new URL('../workflows/issue-triage.yml', import.meta.url),
      'utf8',
    ).match(/MOLTNET_CLI_VERSION: '([^']+)'/)[1],
    GH_BODY: bodyPath,
    ISSUE_FIXTURE: JSON.stringify({
      ...issue,
      updated_at: snapshot.updatedAt,
    }),
    GITHUB_REPOSITORY: 'getlarge/themoltnet',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_RUN_ID: '123456',
    GITHUB_RUN_ATTEMPT: '2',
    ISSUE_NUMBER: '42',
    GITHUB_OUTPUT: outputPath,
    RUNNER_TEMP: dir,
    MOLTNET_TEAM_ID: 'team-id',
  };
  const run = (mode) =>
    spawnSync('node', ['.github/scripts/issue-triage.mjs', mode], {
      env,
      encoding: 'utf8',
    });
  const initial = run('prepare');
  assert.equal(initial.status, 0, initial.stderr);
  const initialSpec = JSON.parse(
    readFileSync(join(dir, 'issue-triage-spec.json'), 'utf8'),
  );
  const initialSnapshot = JSON.parse(
    readFileSync(join(dir, 'issue-triage-snapshot.json'), 'utf8'),
  );
  assert.equal(initialSpec.correlationId, initialSnapshot.correlationId);
  assert.match(initialSnapshot.sourceRevision, /^[a-f0-9]{40}$/);
  assert.match(
    readFileSync(outputPath, 'utf8'),
    new RegExp(`correlation-id=${initialSpec.correlationId}`),
  );
  const prepared = run('prepare-classifier');
  assert.equal(prepared.status, 0, prepared.stderr);
  const spec = JSON.parse(
    readFileSync(join(dir, 'issue-triage-classifier-spec.json'), 'utf8'),
  );
  assert.equal(spec.correlationId, snapshot.correlationId);
  assert.equal(spec.taskType, 'classify');
  assert.match(
    readFileSync(outputPath, 'utf8'),
    /correlation-id=same-correlation/,
  );

  // The fake classifier returns the extraction shape, which must be rejected.
  const spendPath = join(dir, 'spend.json');
  writeFileSync(
    spendPath,
    JSON.stringify({
      version: 1,
      records: [
        {
          taskId: 'extract-task',
          stage: 'extraction',
          missing: false,
          models: [],
          spend: {
            attempts: 2,
            inputTokens: 10,
            outputTokens: 2,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            reasoningTokens: 0,
            estimatedCostUsd: 0.01,
            costComplete: true,
            durationMs: 1000,
          },
        },
      ],
    }),
  );
  env.EXTRACTION_SPEND_REPORT = spendPath;
  env.CLASSIFIER_SPEND_REPORT = spendPath; // A reused task must not be charged twice.
  const published = run('publish');
  assert.equal(published.status, 0, published.stderr);
  assert.match(published.stderr, /Classifier pilot result unavailable/);
  const receipt = JSON.parse(
    readFileSync(join(dir, 'issue-triage-receipt.json'), 'utf8'),
  );
  assert.equal(receipt.version, 1);
  assert.equal(
    receipt.issue.contentDigest,
    issueContentDigest('getlarge/themoltnet', snapshot),
  );
  assert.equal(receipt.issue.body, snapshot.body);
  assert.deepEqual(receipt.extraction, {
    taskId: 'extract-task',
    attemptN: 2,
    inputCid: 'bafyinput',
    outputCid: 'bafyoutput',
  });
  assert.deepEqual(receipt.workflow, {
    runId: '123456',
    runAttempt: 2,
    sourceRevision: snapshot.sourceRevision,
  });
  assert.equal(receipt.ready, true);
  assert.equal(receipt.classification, undefined);
  assert.match(receipt.meaning, /not delivery approval/);
  assert.match(
    readFileSync(outputPath, 'utf8'),
    /receipt=.*issue-triage-receipt.json/,
  );
  const fallbackComment = JSON.parse(readFileSync(bodyPath, 'utf8')).body;
  assert.match(fallbackComment, /Agent workflow spend/);
  assert.match(
    fallbackComment,
    /\| \*\*Total\*\* \| \| 2 \| 10 \| 2 \| 0 \/ 0 \| \$0.0100/,
  );
  assert.match(
    fallbackComment,
    /\[view on GitHub\]\(https:\/\/github.com\/getlarge\/themoltnet\/actions\/runs\/123456\)/,
  );
  assert.match(fallbackComment, /Extraction task: `extract-task`/);
  assert.match(fallbackComment, /Classifier task: `classifier-task`/);
  assert.match(fallbackComment, /Correlation ID: `same-correlation`/);
  const calls = readFileSync(callsPath, 'utf8');
  assert.match(calls, /POST repos\/getlarge\/themoltnet\/issues\/42\/labels/);
  assert.match(calls, /POST repos\/getlarge\/themoltnet\/issues\/42\/comments/);

  const answers = {
    category: {
      type: 'choice',
      choice: 'feature',
      confidence: 0.9,
      probabilities: { bug: 0.05, feature: 0.9, question: 0.025, other: 0.025 },
    },
    ...Object.fromEntries(
      CRITERIA.map((id) => [id, { type: 'bool', probability: 0.75 }]),
    ),
  };
  writeFileSync(
    classifierPath,
    JSON.stringify(
      fixture('classifier-task', classifierSpec, { version: 1, answers }),
    ),
  );
  const classified = run('publish');
  assert.equal(classified.status, 0, classified.stderr);
  const comment = JSON.parse(readFileSync(bodyPath, 'utf8')).body;
  assert.match(comment, /Classifier pilot: \*\*feature\*\*/);
  assert.match(comment, /Added `enhancement` label/);
  assert.match(comment, /moltnet-correlation-id: same-correlation/);
  assert.match(comment, /actions\/runs\/123456/);
  const cliPackages = readFileSync(cliPackagesPath, 'utf8').trim().split('\n');
  assert.ok(cliPackages.length >= 3);
  assert.ok(
    cliPackages.every(
      (name) => name === `@themoltnet/cli@${env.MOLTNET_CLI_VERSION}`,
    ),
  );
  const callsAfterClassification = readFileSync(callsPath, 'utf8');
  assert.equal(
    callsAfterClassification.match(
      /POST repos\/getlarge\/themoltnet\/issues\/42\/labels/g,
    ).length,
    3,
  );

  const mismatched = spawnSync(
    'node',
    ['.github/scripts/issue-triage.mjs', 'publish'],
    {
      env: { ...env, CLASSIFIER_CORRELATION_ID: 'different-correlation' },
      encoding: 'utf8',
    },
  );
  assert.notEqual(mismatched.status, 0);
  assert.match(mismatched.stderr, /different correlation ID/);
  assert.equal(readFileSync(callsPath, 'utf8'), callsAfterClassification);

  // An accepted task with the same correlation but different input is not this triage.
  writeFileSync(
    extractionPath,
    JSON.stringify({
      ...extractionFixture,
      task: {
        ...extractionFixture.task,
        input: { ...extractionFixture.task.input, brief: 'Different issue' },
      },
    }),
  );
  const wrongTask = run('publish');
  assert.notEqual(wrongTask.status, 0);
  assert.match(wrongTask.stderr, /does not match the issue snapshot/);
  assert.equal(readFileSync(callsPath, 'utf8'), callsAfterClassification);
  writeFileSync(extractionPath, JSON.stringify(extractionFixture));

  const receiptPath = join(dir, 'issue-triage-receipt.json');
  rmSync(receiptPath);
  writeFileSync(outputPath, '');
  env.ISSUE_FIXTURE = JSON.stringify({
    ...issue,
    title: 'Changed before publication',
    updated_at: snapshot.updatedAt,
  });
  const stale = run('publish');
  assert.equal(stale.status, 0, stale.stderr);
  assert.match(stale.stdout, /skipping stale result/);
  assert.equal(readFileSync(outputPath, 'utf8'), '');
  assert.throws(() => readFileSync(receiptPath));

  // Writes legitimately change updated_at; unchanged content still emits a receipt.
  env.ISSUE_FIXTURE = JSON.stringify({
    ...issue,
    updated_at: snapshot.updatedAt,
  });
  env.POST_WRITE_ISSUE = JSON.stringify({
    ...issue,
    updated_at: '2026-10-13T11:00:00Z',
  });
  rmSync(bodyPath);
  const timestampOnly = run('publish');
  assert.equal(timestampOnly.status, 0, timestampOnly.stderr);
  assert.match(readFileSync(outputPath, 'utf8'), /receipt=/);

  rmSync(receiptPath);
  rmSync(bodyPath);
  writeFileSync(outputPath, '');
  env.POST_WRITE_ISSUE = JSON.stringify({
    ...issue,
    body: 'Changed during publication',
    updated_at: '2026-10-13T11:00:00Z',
  });
  const changed = run('publish');
  assert.equal(changed.status, 0, changed.stderr);
  assert.match(changed.stdout, /no current triage receipt/);
  assert.equal(readFileSync(outputPath, 'utf8'), '');
  assert.throws(() => readFileSync(receiptPath));
  rmSync(bodyPath);
  env.POST_WRITE_ISSUE = JSON.stringify({
    ...issue,
    state: 'closed',
    updated_at: '2026-10-13T11:00:00Z',
  });
  const closed = run('publish');
  assert.equal(closed.status, 0, closed.stderr);
  assert.match(closed.stdout, /no current triage receipt/);
  assert.equal(readFileSync(outputPath, 'utf8'), '');
  assert.throws(() => readFileSync(receiptPath));
});

test('validates accepted task provenance rather than trusting correlation alone', () => {
  const expected = buildSpec(issue, 'getlarge/themoltnet', false);
  const task = {
    id: 'task',
    teamId: 'team',
    taskType: 'freeform',
    status: 'completed',
    correlationId: expected.correlationId,
    inputCid: 'bafyinput',
    input: expected.input,
    tags: expected.tags,
    acceptedAttemptN: 2,
  };
  const attempt = {
    taskId: 'task',
    attemptN: 2,
    status: 'completed',
    outputCid: 'bafyoutput',
    output: { result: {} },
  };
  assert.equal(
    validateAcceptedTask(task, attempt, expected, 'task', 'team').receipt
      .attemptN,
    2,
  );
  assert.throws(() =>
    validateAcceptedTask(
      { ...task, teamId: undefined },
      attempt,
      expected,
      'task',
      undefined,
    ),
  );
  for (const patch of [
    { id: 'other' },
    { teamId: 'other' },
    { taskType: 'classify' },
    { status: 'failed' },
    { correlationId: 'other' },
    { inputCid: null },
    { tags: [] },
    { acceptedAttemptN: 1 },
  ]) {
    assert.throws(() =>
      validateAcceptedTask(
        { ...task, ...patch },
        attempt,
        expected,
        'task',
        'team',
      ),
    );
  }
  for (const patch of [
    { taskId: 'other' },
    { attemptN: 1 },
    { status: 'running' },
    { outputCid: null },
    { output: null },
  ]) {
    assert.throws(() =>
      validateAcceptedTask(
        task,
        { ...attempt, ...patch },
        expected,
        'task',
        'team',
      ),
    );
  }
});

test('binds the canonical service-normalized freeform input without accepting arbitrary criteria', () => {
  const expected = buildSpec(issue, 'getlarge/themoltnet', false);
  // The service adds this gate to older requests that omitted successCriteria.
  // New requests state the identical contract so normalization is idempotent.
  const { successCriteria: _explicitCriteria, ...olderRequestInput } =
    expected.input;
  const normalized = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `
import {readFileSync} from 'node:fs';
import {normalizeTaskInputForCreate} from './libs/tasks/src/validation.ts';
const inputs = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(inputs.map(input => normalizeTaskInputForCreate('freeform', input))));
`,
    ],
    {
      input: JSON.stringify([olderRequestInput, expected.input]),
      encoding: 'utf8',
    },
  );
  assert.equal(normalized.status, 0, normalized.stderr);
  const [normalizedInput, normalizedExplicitInput] = JSON.parse(
    normalized.stdout,
  );
  assert.deepEqual(expected.input, normalizedExplicitInput);
  assert.deepEqual(expected.input, normalizedInput);
  const task = {
    id: 'task',
    teamId: 'team',
    taskType: 'freeform',
    status: 'completed',
    correlationId: expected.correlationId,
    inputCid: 'bafyinput',
    input: normalizedInput,
    tags: expected.tags,
    acceptedAttemptN: 1,
  };
  const attempt = {
    taskId: 'task',
    attemptN: 1,
    status: 'completed',
    outputCid: 'bafyoutput',
    output: { result: {} },
  };
  assert.equal(
    validateAcceptedTask(task, attempt, expected, 'task', 'team').receipt
      .attemptN,
    1,
  );
  assert.throws(() =>
    validateAcceptedTask(
      { ...task, input: olderRequestInput },
      attempt,
      expected,
      'task',
      'team',
    ),
  );
  assert.throws(() =>
    validateAcceptedTask(
      {
        ...task,
        input: {
          ...normalizedInput,
          successCriteria: {
            ...normalizedInput.successCriteria,
            rubric: { criteria: [] },
          },
        },
      },
      attempt,
      expected,
      'task',
      'team',
    ),
  );
});

test('content digest is stable across projection changes and binds exact issue identity and text', () => {
  const digest = issueContentDigest('getlarge/themoltnet', issue);
  assert.equal(
    digest,
    issueContentDigest('GETLARGE/THEMOLTNET', {
      ...issue,
      labels: [],
      updated_at: 'new',
    }),
  );
  for (const patch of [
    { number: 43 },
    { title: 'Changed' },
    { body: issue.body + ' ' },
  ]) {
    assert.notEqual(
      digest,
      issueContentDigest('getlarge/themoltnet', { ...issue, ...patch }),
    );
  }
  assert.notEqual(digest, issueContentDigest('other/repo', issue));
  assert.throws(
    () =>
      buildSpec(
        { ...issue, body: 'x'.repeat(60_001) },
        'getlarge/themoltnet',
        false,
      ),
    /oversized/,
  );
});
