import { describe, expect, it } from 'vitest';

import { createSubmitOutputTool } from './submit-output-tool.js';

/**
 * The tool is constructed via pi-coding-agent's `defineTool` — its
 * `execute` is reachable through the wrapped definition. The exact
 * shape (`tool.execute(_id, params)`) is shared with every other
 * defineTool call in this codebase; we exercise it directly here
 * without booting a real session.
 */
function callExecute(handle: ReturnType<typeof createSubmitOutputTool>) {
  const tool = handle.tool as unknown as {
    execute: (
      id: string,
      params: { output: unknown },
    ) => Promise<{
      content: Array<{ type: 'text'; text: string }>;
      details?: Record<string, unknown>;
      isError?: boolean;
    }>;
  };
  return (output: unknown) => tool.execute('id', { output });
}

const validFulfillBriefOutput = {
  branch: 'feat/x',
  commits: [],
  pullRequestUrl: null,
  diaryEntryIds: [],
  summary: 's',
};

describe('createSubmitOutputTool', () => {
  it('throws on unknown task types so the executor falls back to the parser', () => {
    expect(() => createSubmitOutputTool('not_a_real_type')).toThrow(
      /no output schema registered/,
    );
  });

  it('registers the tool as `submit_<task_type>_output`', () => {
    const handle = createSubmitOutputTool('fulfill_brief');
    expect((handle.tool as unknown as { name: string }).name).toBe(
      'submit_fulfill_brief_output',
    );
  });

  it('captures a valid payload and exposes it via getCaptured()', async () => {
    const handle = createSubmitOutputTool('fulfill_brief');
    expect(handle.getCaptured()).toBeNull();
    expect(handle.getCallCount()).toBe(0);

    const result = await callExecute(handle)(validFulfillBriefOutput);

    expect(result.isError).toBeFalsy();
    expect(handle.getCaptured()).toEqual(validFulfillBriefOutput);
    expect(handle.getCallCount()).toBe(1);
    expect(result.content[0].text).toContain('captured');
  });

  it('returns a tool error on schema-invalid args without capturing', async () => {
    const handle = createSubmitOutputTool('fulfill_brief');
    const result = await callExecute(handle)({
      branch: 123, // wrong type — schema requires string
      commits: [],
      pullRequestUrl: null,
      diaryEntryIds: [],
      summary: 's',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/schema validation/i);
    expect(handle.getCaptured()).toBeNull();
    expect(handle.getCallCount()).toBe(0);
  });

  it('lets the model recover after a schema-invalid first call', async () => {
    const handle = createSubmitOutputTool('fulfill_brief');
    const exec = callExecute(handle);

    const bad = await exec({ branch: 99 });
    expect(bad.isError).toBe(true);
    expect(handle.getCaptured()).toBeNull();

    const good = await exec(validFulfillBriefOutput);
    expect(good.isError).toBeFalsy();
    expect(handle.getCaptured()).toEqual(validFulfillBriefOutput);
    expect(handle.getCallCount()).toBe(1);
  });

  it('keeps the latest valid capture when called more than once', async () => {
    const handle = createSubmitOutputTool('fulfill_brief');
    const exec = callExecute(handle);

    await exec(validFulfillBriefOutput);
    const second = {
      ...validFulfillBriefOutput,
      summary: 'second submission supersedes the first',
    };
    await exec(second);

    expect(handle.getCaptured()).toEqual(second);
    expect(handle.getCallCount()).toBe(2);
  });

  it('works for every built-in task type', async () => {
    // Smoke-test the schema lookup path for every task type the prompts
    // reference. We don't construct full valid payloads for each — that
    // would couple this test to every output shape — we just verify the
    // tool factory accepts the type and the produced tool has the right
    // name. Validation is exercised in dedicated cases above.
    const types = [
      'fulfill_brief',
      'assess_brief',
      'curate_pack',
      'render_pack',
      'judge_pack',
    ];
    for (const t of types) {
      const handle = createSubmitOutputTool(t);
      expect((handle.tool as unknown as { name: string }).name).toBe(
        `submit_${t}_output`,
      );
    }
  });
});
