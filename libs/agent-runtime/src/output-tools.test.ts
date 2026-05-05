import { describe, expect, it } from 'vitest';

import {
  getSubmitOutputContract,
  submitOutputToolName,
} from './output-tools.js';

describe('submitOutputToolName', () => {
  it('builds `submit_<task_type>_output` for any string', () => {
    expect(submitOutputToolName('fulfill_brief')).toBe(
      'submit_fulfill_brief_output',
    );
    expect(submitOutputToolName('judge_pack')).toBe('submit_judge_pack_output');
    // No special-casing — the function is a pure formatter so the
    // prompt builder can advertise a tool name without knowing whether
    // an output schema is registered yet.
    expect(submitOutputToolName('whatever_x')).toBe('submit_whatever_x_output');
  });
});

describe('getSubmitOutputContract', () => {
  it('returns null for an unknown task type', () => {
    expect(getSubmitOutputContract('totally_made_up')).toBeNull();
  });

  it('produces a complete contract for every built-in task type', () => {
    const types = [
      'fulfill_brief',
      'assess_brief',
      'curate_pack',
      'render_pack',
      'judge_pack',
    ] as const;
    for (const t of types) {
      const c = getSubmitOutputContract(t);
      expect(c, `${t} contract`).not.toBeNull();
      expect(c!.taskType).toBe(t);
      expect(c!.toolName).toBe(`submit_${t}_output`);
      // The schema is the task type's *Output TObject — pi-extension
      // and any future executor will register it as tool parameters
      // verbatim, so the type/properties shape MUST be present.
      expect(c!.parametersSchema).toBeDefined();
      expect(
        (c!.parametersSchema as { type?: string }).type,
        `${t} parametersSchema is an object`,
      ).toBe('object');
      // Description is shared, so the model sees the same advertised
      // purpose regardless of which executor registers the tool.
      expect(c!.description).toMatch(/Submit the structured output/);
    }
  });

  it('keeps tool name in sync with submitOutputToolName', () => {
    // Regression guard: nothing in the runtime should be allowed to
    // build a divergent tool name string. If the contract's `toolName`
    // ever drifted from `submitOutputToolName`, the prompt and the
    // executor would advertise different names and the tool would be
    // un-callable.
    const c = getSubmitOutputContract('fulfill_brief');
    expect(c!.toolName).toBe(submitOutputToolName('fulfill_brief'));
  });
});
