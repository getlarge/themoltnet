import { describe, expect, it } from 'vitest';

import { createInlineContext } from './context.js';
import { createTaskStep } from './task-step.js';
import type { WorkflowContext } from './types.js';

describe('createTaskStep', () => {
  it('supports legacy contexts without new optional capabilities', async () => {
    const steps: string[] = [];
    const legacyContext: WorkflowContext = {
      step(name, fn) {
        steps.push(name);
        return fn();
      },
      sleepFor: () => Promise.resolve(),
    };

    const result = await createTaskStep(
      legacyContext,
      'child.create',
      (metadata) => Promise.resolve({ metadata }),
    );

    expect(steps).toEqual(['child.create']);
    expect(result.metadata).toEqual({
      stepName: 'child.create',
      idempotencyKey: undefined,
    });
  });

  it('isolates idempotency namespaces for independent inline runs', async () => {
    const first = await createTaskStep(
      createInlineContext('inline-a'),
      'child.create',
      (metadata) => Promise.resolve(metadata.idempotencyKey),
    );
    const second = await createTaskStep(
      createInlineContext('inline-b'),
      'child.create',
      (metadata) => Promise.resolve(metadata.idempotencyKey),
    );

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  it('numbers repeated logical task creates within one inline run', async () => {
    const ctx = createInlineContext('inline-run');
    const first = await createTaskStep(ctx, 'child.create', (metadata) =>
      Promise.resolve(metadata),
    );
    const second = await createTaskStep(ctx, 'child.create', (metadata) =>
      Promise.resolve(metadata),
    );

    expect(first.stepName).toBe('child.create');
    expect(second.stepName).toBe('child.create#2');
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });
});
