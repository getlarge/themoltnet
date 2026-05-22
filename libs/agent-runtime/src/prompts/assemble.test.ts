import { describe, expect, it } from 'vitest';

import { assembleTaskPrompt, type PromptSection } from './assemble.js';

describe('assembleTaskPrompt', () => {
  it('joins non-empty sections with a blank line', () => {
    const sections: PromptSection[] = [
      { id: 't.a', source: 'static', body: 'alpha' },
      { id: 't.b', source: 'static', body: 'beta' },
    ];
    const out = assembleTaskPrompt('t', sections);
    expect(out.text).toBe('alpha\n\nbeta');
    expect(out.taskType).toBe('t');
  });

  it('renders the optional header as `## ${header}` above body', () => {
    const sections: PromptSection[] = [
      { id: 't.a', source: 'task_input', header: 'Goal', body: 'do the thing' },
    ];
    expect(assembleTaskPrompt('t', sections).text).toBe(
      '## Goal\n\ndo the thing',
    );
  });

  it('drops empty bodies from text but keeps them in the trace', () => {
    const sections: PromptSection[] = [
      { id: 't.a', source: 'static', body: 'alpha' },
      { id: 't.absent', source: 'workspace', header: 'Workspace', body: '' },
      { id: 't.b', source: 'static', body: 'beta' },
    ];
    const out = assembleTaskPrompt('t', sections);
    expect(out.text).toBe('alpha\n\nbeta');
    expect(out.trace).toEqual([
      { id: 't.a', source: 'static', header: undefined, char_count: 5 },
      {
        id: 't.absent',
        source: 'workspace',
        header: 'Workspace',
        char_count: 0,
      },
      { id: 't.b', source: 'static', header: undefined, char_count: 4 },
    ]);
  });

  it('preserves section ordering', () => {
    const ids = ['s1', 's2', 's3', 's4'];
    const sections: PromptSection[] = ids.map((id) => ({
      id,
      source: 'static',
      body: id,
    }));
    const out = assembleTaskPrompt('t', sections);
    expect(out.text).toBe('s1\n\ns2\n\ns3\n\ns4');
    expect(out.trace.map((t) => t.id)).toEqual(ids);
  });

  it('counts characters of body (not header) in char_count', () => {
    const sections: PromptSection[] = [
      { id: 't.a', source: 'static', header: 'Long header text', body: 'x' },
    ];
    expect(assembleTaskPrompt('t', sections).trace[0].char_count).toBe(1);
  });

  it('returns empty text when every section is empty', () => {
    const sections: PromptSection[] = [
      { id: 't.a', source: 'static', body: '' },
      { id: 't.b', source: 'static', body: '' },
    ];
    const out = assembleTaskPrompt('t', sections);
    expect(out.text).toBe('');
    expect(out.trace).toHaveLength(2);
  });
});
