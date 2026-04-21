import { describe, expect, it } from 'vitest';

import {
  buildPiJudgeRecipeManifest,
  computePiJudgeRecipeCid,
} from './judge-recipe-cid.js';

describe('computePiJudgeRecipeCid', () => {
  const baseInput = {
    judgePrompt: 'Judge the rendered pack against the source entries.',
    rubric: 'Score coverage, grounding, and faithfulness from 0.0 to 1.0.',
    skillFragment: 'Phase 6: Pack-to-docs transformation',
    implementationSource: 'judge.ts@abc123',
    promptAsset: 'pi://judge/rendered-pack/v1',
    rubricAsset: 'builtin:fidelity/v1',
    skillSourcePath: '.agents/skills/legreffier-explore/SKILL.md#phase-6',
    overrides: {
      pi: '0.67.68',
      piExtension: '0.1.0',
      sdk: '0.7.0',
    },
  } as const;

  it('is stable for the same inputs', () => {
    const first = computePiJudgeRecipeCid(baseInput);
    const second = computePiJudgeRecipeCid(baseInput);

    expect(first.cid).toBe(second.cid);
    expect(first.manifest).toEqual(second.manifest);
  });

  it('changes when the rubric changes', () => {
    const first = computePiJudgeRecipeCid(baseInput);
    const second = computePiJudgeRecipeCid({
      ...baseInput,
      rubric: 'Score only faithfulness.',
    });

    expect(first.cid).not.toBe(second.cid);
  });

  it('stores the hashed inputs in the manifest', () => {
    const result = buildPiJudgeRecipeManifest(baseInput);

    expect(result.kind).toBe('pi-judge-recipe/v1');
    expect(result.assets.skillSourcePath).toContain('legreffier-explore');
    expect(result.hashes.judgePromptSha256).toHaveLength(64);
    expect(result.hashes.rubricSha256).toHaveLength(64);
    expect(result.hashes.skillFragmentSha256).toHaveLength(64);
    expect(result.hashes.implementationSha256).toHaveLength(64);
  });
});
