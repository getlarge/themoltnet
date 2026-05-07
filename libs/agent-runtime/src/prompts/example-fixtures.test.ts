import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Task } from '@moltnet/tasks';
import { describe, expect, it } from 'vitest';

import { buildPromptForTask } from './index.js';

const ctx = { diaryId: 'd1', taskId: 't1' };
const examplesDir = resolve(__dirname, '../../../../examples/tasks');

function load(name: string): Task {
  return JSON.parse(readFileSync(resolve(examplesDir, name), 'utf8')) as Task;
}

describe('examples/tasks pack-pipeline fixtures', () => {
  it('curate-ci-incidents.json validates and builds a prompt', () => {
    const task = load('curate-ci-incidents.json');
    expect(task.taskType).toBe('curate_pack');
    const prompt = buildPromptForTask(task, ctx);
    expect(prompt).toContain('CI pipelines');
    expect(prompt).toContain('moltnet_pack_create');
  });

  it('render-pack.json validates and builds a prompt', () => {
    const task = load('render-pack.json');
    expect(task.taskType).toBe('render_pack');
    const prompt = buildPromptForTask(task, ctx);
    expect(prompt).toContain('moltnet_pack_render');
  });

  it('judge-pack.json validates and builds a prompt', () => {
    const task = load('judge-pack.json');
    expect(task.taskType).toBe('judge_pack');
    const prompt = buildPromptForTask(task, ctx);
    expect(prompt).toContain('pack-fidelity-v3');
    expect(prompt).toContain('coverage');
    expect(prompt).toContain('deterministic_coverage_check');
    // The grounding criterion uses the per-claim binary mode added in
    // #999. The scoring rule MUST be in the prompt so the judge knows
    // how to enumerate assertions and derive the criterion score.
    expect(prompt).toContain('llm_checklist');
  });
});
