import { describe, expect, it } from 'vitest';

import {
  type AdmissionObservation,
  admit,
  reconcileStageLabels,
} from './coordination.js';

function observation(): AdmissionObservation {
  return {
    workItem: { provider: 'github', repository: 'example/repo', key: '42' },
    briefDigest: 'approved-brief',
    open: true,
    eligible: true,
    paused: false,
    cancelled: false,
    approval: {
      authorized: true,
      eventId: 'event-1',
      briefDigest: 'approved-brief',
    },
  };
}

describe('admission', () => {
  it('retains the approval event for duplicate-delivery reconciliation', () => {
    expect(admit(observation())).toEqual(admit(observation()));
    expect(admit(observation())?.approvalEventId).toBe('event-1');
  });
  it('rejects a stale approval after editing acceptance criteria', () => {
    expect(admit({ ...observation(), briefDigest: 'changed' })).toBeUndefined();
  });
  it('does not admit a label without an authorized actor', () => {
    const input = observation();
    input.approval!.authorized = false;
    expect(admit(input)).toBeUndefined();
  });
  it.each([
    { open: false },
    { eligible: false },
    { paused: true },
    { cancelled: true },
    { approval: undefined },
  ])('blocks admission for %j', (override) => {
    expect(admit({ ...observation(), ...override })).toBeUndefined();
  });
});

describe('stage labels', () => {
  it.each([
    { stages: { delivery: 'agent:working', review: 'agent:review' } },
    { stages: { delivery: 'in-progress', review: 'awaiting-checks' } },
  ])(
    'uses repository configuration and preserves unrelated labels',
    (policy) => {
      expect(
        reconcileStageLabels(['bug', policy.stages.delivery], 'review', policy),
      ).toEqual({
        add: [policy.stages.review],
        remove: [policy.stages.delivery],
      });
      expect(
        reconcileStageLabels(['bug', policy.stages.review], 'review', policy),
      ).toEqual({ add: [], remove: [] });
    },
  );
  it('rejects ambiguous label ownership', () => {
    expect(() =>
      reconcileStageLabels([], 'review', {
        stages: { delivery: 'active', review: 'active' },
      }),
    ).toThrow();
  });
  it('does not invent a label for an unknown stage', () => {
    expect(() =>
      reconcileStageLabels([], 'review', { stages: { delivery: 'active' } }),
    ).toThrow();
  });
});
