// The runtime-profile context recipe catalogue is owned by @moltnet/tasks and
// re-exported through @themoltnet/sdk so the console and the docs share a single
// source of truth (no drift between what the docs teach and what the console
// applies). This module preserves the historical export surface the docs
// components and validation script import.
export {
  resolveRuntimeProfileContextRecipe,
  RUNTIME_PROFILE_CONTEXT_CATALOGUE,
  type RuntimeProfileContextCatalogue,
  type ContextRef as RuntimeProfileContextEntry,
  type RuntimeProfileContextRecipe,
  runtimeProfileContextRecipeDescription,
  runtimeProfileContextRecipeIds,
} from '@themoltnet/sdk';
