import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';

import { ContextRef, TaskContext } from './context.js';
import {
  resolveRuntimeProfileContextRecipe,
  RUNTIME_PROFILE_CONTEXT_CATALOGUE,
  runtimeProfileContextRecipeDescription,
  runtimeProfileContextRecipeIds,
} from './runtime-profile-context-recipes.js';

describe('runtime-profile context recipe catalogue', () => {
  it('is versioned', () => {
    expect(RUNTIME_PROFILE_CONTEXT_CATALOGUE.version).toBeGreaterThanOrEqual(1);
  });

  it('validates every fragment against the ContextRef schema profiles use', () => {
    const fragments = Object.entries(
      RUNTIME_PROFILE_CONTEXT_CATALOGUE.fragments,
    );
    expect(fragments.length).toBeGreaterThan(0);
    for (const [id, fragment] of fragments) {
      expect(Value.Check(ContextRef, fragment), `fragment ${id}`).toBe(true);
      // A fragment's map key is its own slug — the console relies on slug
      // identity for de-duplication when applying a recipe.
      expect(fragment.slug, `fragment ${id} slug matches its key`).toBe(id);
    }
  });

  it('exposes recipe ids in catalogue order', () => {
    expect(runtimeProfileContextRecipeIds).toEqual(
      Object.keys(RUNTIME_PROFILE_CONTEXT_CATALOGUE.recipes),
    );
  });

  it('ships the documented starter recipes', () => {
    expect(runtimeProfileContextRecipeIds).toContain('standard-engineering@v1');
    expect(runtimeProfileContextRecipeIds).toContain('run-eval-direct@v1');
    expect(runtimeProfileContextRecipeIds).toContain('artifact-planner@v1');
  });

  it('keeps the artifact planner repository-agnostic and bounded', () => {
    const [planner] = resolveRuntimeProfileContextRecipe('artifact-planner@v1');

    expect(planner.content).toContain('exact artifact CIDs');
    expect(planner.content).toContain('Do not search diaries');
    expect(planner.content).toContain('Do not substitute filename');
    expect(planner.content).not.toContain('drizzle');
    expect(planner.content).not.toContain('generated/');
    expect(planner.content).not.toContain('lockfile');
  });

  it('keeps standard-engineering@v1 pinned and adds a hardened @v2', () => {
    expect(runtimeProfileContextRecipeIds).toContain('standard-engineering@v2');

    // @v1 stays byte-identical to what was backfilled onto deployed profiles.
    const v1 = resolveRuntimeProfileContextRecipe('standard-engineering@v1');
    const v1Verification = v1.find(
      (e) => e.slug === 'verification-and-artifacts-v1',
    );
    expect(v1Verification?.content).toContain(
      'Upload large files, binary files, logs',
    );

    // @v2 swaps in the hardened verification fragment and nothing else.
    const v2 = resolveRuntimeProfileContextRecipe('standard-engineering@v2');
    expect(v2.map((e) => e.slug)).toEqual([
      'proactive-memory-v1',
      'task-diary-discipline-v1',
      'accountable-delivery-v1',
      'judgment-diary-v1',
      'verification-and-artifacts-v2',
    ]);
    const v2Verification = v2.find(
      (e) => e.slug === 'verification-and-artifacts-v2',
    );
    expect(v2Verification?.content).toContain('Never upload secrets');
    expect(v2Verification?.content).not.toContain('Upload large files');
  });

  it('resolves every recipe to a valid, applyable context array', () => {
    for (const recipeId of runtimeProfileContextRecipeIds) {
      const entries = resolveRuntimeProfileContextRecipe(recipeId);
      expect(entries.length, `recipe ${recipeId}`).toBeGreaterThan(0);
      // Resolved entries must satisfy the per-entry schema and the profile
      // context array bound (maxItems), since applying writes them verbatim
      // into RuntimeProfile.context.
      expect(Value.Check(TaskContext, entries), `recipe ${recipeId}`).toBe(
        true,
      );
      expect(runtimeProfileContextRecipeDescription(recipeId)).not.toBe('');
    }
  });

  it('returns caller-owned clones that cannot mutate the catalogue', () => {
    const recipeId = 'run-eval-direct@v1';
    const first = resolveRuntimeProfileContextRecipe(recipeId);
    first[0].content = 'mutated by consumer';
    const second = resolveRuntimeProfileContextRecipe(recipeId);
    expect(second[0].content).not.toBe('mutated by consumer');
  });

  it('exposes frozen catalogue data', () => {
    expect(Object.isFrozen(RUNTIME_PROFILE_CONTEXT_CATALOGUE)).toBe(true);
    expect(Object.isFrozen(RUNTIME_PROFILE_CONTEXT_CATALOGUE.fragments)).toBe(
      true,
    );
    expect(Object.isFrozen(runtimeProfileContextRecipeIds)).toBe(true);
  });

  it('throws on an unknown recipe id', () => {
    expect(() =>
      resolveRuntimeProfileContextRecipe('does-not-exist@v9'),
    ).toThrow(/Unknown runtime-profile context recipe/);
    expect(() => runtimeProfileContextRecipeDescription('nope@v1')).toThrow(
      /Unknown runtime-profile context recipe/,
    );
  });
});
