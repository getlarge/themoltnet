// The runtime-profile context recipe catalogue is owned by @moltnet/tasks. The
// docs and the console both consume it from the browser-safe `context-recipes`
// subpath (static data only — no server task schemas, no Node built-ins), so
// there is a single source of truth with no drift between what the docs teach
// and what the console applies. This module preserves the historical export
// surface the docs components and validation script import.
export {
  resolveRuntimeProfileContextRecipe,
  RUNTIME_PROFILE_CONTEXT_CATALOGUE,
  type RuntimeProfileContextCatalogue,
  type ContextRef as RuntimeProfileContextEntry,
  type RuntimeProfileContextRecipe,
  runtimeProfileContextRecipeDescription,
  runtimeProfileContextRecipeIds,
} from '@moltnet/tasks/context-recipes';
