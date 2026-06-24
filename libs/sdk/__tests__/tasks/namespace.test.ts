import type { Client } from '@moltnet/api-client';
import { describe, expect, it } from 'vitest';

import { createTasksNamespace } from '../../src/namespaces/tasks.js';

const TEAM = '6743b4b1-6b93-46e2-a048-19490f04f91a';
const DIARY = '6e4d9948-8ec5-4f59-b82a-3acbc4bbc396';

describe('TasksNamespace builder factories', () => {
  it('exposes buildFreeform that returns a working builder', () => {
    const ns = createTasksNamespace({ client: {} as Client });
    const body = ns
      .buildFreeform({ brief: 'b' })
      .team(TEAM)
      .diary(DIARY)
      .build();
    expect(body.taskType).toBe('freeform');
    expect(body.teamId).toBe(TEAM);
  });

  it('exposes buildTask generic escape hatch', () => {
    const ns = createTasksNamespace({ client: {} as Client });
    const body = ns
      .buildTask('freeform', { brief: 'x' })
      .team(TEAM)
      .diary(DIARY)
      .build();
    expect(body.taskType).toBe('freeform');
  });
});
