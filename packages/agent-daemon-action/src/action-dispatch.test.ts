import { describe, expect, it } from 'vitest';

import { loadAction, stepById } from './test-support.js';

const action = loadAction();

describe('mention dispatch', () => {
  it('turns a comment into a task only outside drain mode', () => {
    // A drain worker started by a comment (for example a docs review
    // command) claims tasks another job created; treating the comment as a
    // new request would need GITHUB_TOKEN and create a stray task.
    const condition = stepById(action, 'dispatch').if ?? '';

    expect(condition).toContain("github.event_name == 'issue_comment'");
    expect(condition).toContain("inputs.mode != 'drain'");
  });
});
