import catalogue from '../data/runtime-profile-contexts.json';

type RuntimeProfileContextBinding =
  | 'skill'
  | 'context_inline'
  | 'prompt_prefix'
  | 'user_inline';

export interface RuntimeProfileContextEntry {
  slug: string;
  binding: RuntimeProfileContextBinding;
  content: string;
}

interface RuntimeProfileContextRecipe {
  description: string;
  fragments: string[];
}

const fragments = catalogue.fragments as Record<
  string,
  RuntimeProfileContextEntry
>;
const recipes = catalogue.recipes as Record<
  string,
  RuntimeProfileContextRecipe
>;

/** Resolve a named docs catalogue recipe into the JSON array accepted by the Console. */
export function resolveRuntimeProfileContextRecipe(
  recipeId: string,
): RuntimeProfileContextEntry[] {
  const recipe = recipes[recipeId];
  if (!recipe) {
    throw new Error(`Unknown runtime-profile context recipe: ${recipeId}`);
  }
  return recipe.fragments.map((fragmentId) => {
    const fragment = fragments[fragmentId];
    if (!fragment) {
      throw new Error(
        `Runtime-profile context recipe ${recipeId} references missing fragment ${fragmentId}`,
      );
    }
    return fragment;
  });
}

export function runtimeProfileContextRecipeDescription(
  recipeId: string,
): string {
  const recipe = recipes[recipeId];
  if (!recipe) {
    throw new Error(`Unknown runtime-profile context recipe: ${recipeId}`);
  }
  return recipe.description;
}

export const runtimeProfileContextRecipeIds = Object.keys(recipes);
