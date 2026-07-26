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

  it('throws on an unknown recipe id', () => {
    expect(() =>
      resolveRuntimeProfileContextRecipe('does-not-exist@v9'),
    ).toThrow(/Unknown runtime-profile context recipe/);
    expect(() => runtimeProfileContextRecipeDescription('nope@v1')).toThrow(
      /Unknown runtime-profile context recipe/,
    );
  });
});
