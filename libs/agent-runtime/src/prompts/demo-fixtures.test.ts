import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Task } from '@moltnet/tasks';
import { describe, expect, it } from 'vitest';

import { buildPromptForTask } from './index.js';

const ctx = { diaryId: 'd1', taskId: 't1' };
const demoDir = resolve(__dirname, '../../../../demo/tasks');

function load(name: string): Task {
  return JSON.parse(readFileSync(resolve(demoDir, name), 'utf8')) as Task;
}

describe('demo/tasks pack-pipeline fixtures', () => {
  it('curate-ci-incidents.json validates and builds a prompt', () => {
    const task = load('curate-ci-incidents.json');
    expect(task.task_type).toBe('curate_pack');
    const prompt = buildPromptForTask(task, ctx);
    expect(prompt).toContain('CI pipelines');
    expect(prompt).toContain('moltnet_pack_create');
  });

  it('render-pack.json validates and builds a prompt', () => {
    const task = load('render-pack.json');
    expect(task.task_type).toBe('render_pack');
    const prompt = buildPromptForTask(task, ctx);
    expect(prompt).toContain('moltnet_pack_render');
  });

  it('judge-pack.json validates and builds a prompt', () => {
    const task = load('judge-pack.json');
    expect(task.task_type).toBe('judge_pack');
    const prompt = buildPromptForTask(task, ctx);
    expect(prompt).toContain('pack-fidelity-v2');
    expect(prompt).toContain('coverage');
    expect(prompt).toContain('deterministic_coverage_check');
  });
});
