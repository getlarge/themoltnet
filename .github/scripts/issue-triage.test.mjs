import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
          },
          ...criteria.slice(1),
        ],
      },
    },
    issue,
  );
  assert.deepEqual(sanitized[0].evidence, ['Done when: status appears.']);
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
  writeFileSync(extractionPath, JSON.stringify({ result: { criteria } }));
  writeFileSync(classifierPath, JSON.stringify({ result: { criteria } }));
  writeFileSync(outputPath, '');
  writeFileSync(callsPath, '');
  writeFileSync(cliPackagesPath, '');
  writeFileSync(
    join(dir, 'npx'),
    '#!/bin/sh\nprintf "%s\\n" "$2" >> "$CLI_PACKAGES"\nif [ "$5" = classifier-task ]; then cat "$CLASSIFIER_FIXTURE"; else cat "$EXTRACTION_FIXTURE"; fi\n',
    { mode: 0o755 },
  );
  writeFileSync(
    join(dir, 'gh'),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$GH_CALLS"\nif [ "$3" = GET ]; then printf "%s" "$ISSUE_FIXTURE"; elif [ "$3" = POST ] && [ "$4" = repos/getlarge/themoltnet/issues/42/comments ]; then cat > "$GH_BODY"; fi\n',
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
    JSON.stringify({
      version: 1,
      answers,
    }),
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
});
