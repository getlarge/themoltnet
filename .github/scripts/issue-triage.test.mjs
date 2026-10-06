import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildSpec,
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
  assert.equal(
    spec.input.outputContract.schema.properties.criteria.minItems,
    5,
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
  }));
  assert.equal(parseVerdict({ result: { criteria } }).length, 5);
  assert.throws(() =>
    parseVerdict({ result: { criteria: criteria.slice(1) } }),
  );
  assert.throws(() =>
    parseVerdict({ result: { criteria: [...criteria.slice(1), criteria[1]] } }),
  );
  assert.throws(() =>
    parseVerdict({
      result: {
        criteria: [{ ...criteria[0], passed: 'yes' }, ...criteria.slice(1)],
      },
    }),
  );
});

test('renders the verdict and per-criterion reasons', () => {
  const criteria = CRITERIA.map((id) => ({
    id,
    passed: true,
    reason: 'Present',
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
});
