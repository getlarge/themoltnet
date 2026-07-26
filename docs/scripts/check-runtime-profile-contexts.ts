import {
  CONTEXT_BINDINGS,
  CONTEXT_REF_MAX_CONTENT_LENGTH,
  type ContextBinding,
  RUNTIME_PROFILE_CONTEXT_CATALOGUE,
} from '@themoltnet/sdk';

// The catalogue is owned by @moltnet/tasks (validated there against the
// ContextRef TypeBox schema). This guard adds the docs-facing invariants: the
// catalogue version this docs build understands, and the fragment set the
// published standard-engineering@v1 recipe promises.
const bindings = new Set<ContextBinding>(CONTEXT_BINDINGS);
const slugPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const requiredStandardEngineeringFragments = [
  'proactive-memory-v1',
  'task-diary-discipline-v1',
  'accountable-delivery-v1',
  'judgment-diary-v1',
  'verification-and-artifacts-v1',
];

const catalogue = RUNTIME_PROFILE_CONTEXT_CATALOGUE;

if (catalogue.version !== 1) {
  throw new Error(
    `Unsupported runtime-profile context catalogue version: ${catalogue.version}`,
  );
}

for (const [fragmentId, entry] of Object.entries(catalogue.fragments)) {
  if (fragmentId !== entry.slug || !slugPattern.test(entry.slug)) {
    throw new Error(`Invalid runtime-profile context slug: ${fragmentId}`);
  }
  if (
    !bindings.has(entry.binding) ||
    entry.content.length === 0 ||
    entry.content.length > CONTEXT_REF_MAX_CONTENT_LENGTH
  ) {
    throw new Error(`Invalid RuntimeProfileContext fragment: ${fragmentId}`);
  }
}

for (const [recipeId, recipe] of Object.entries(catalogue.recipes)) {
  if (
    !recipe.description ||
    recipe.fragments.length < 1 ||
    recipe.fragments.length > 5
  ) {
    throw new Error(`Invalid runtime-profile context recipe: ${recipeId}`);
  }
  const resolved = recipe.fragments.map((fragmentId) => {
    const entry = catalogue.fragments[fragmentId];
    if (!entry) {
      throw new Error(`${recipeId} references missing fragment ${fragmentId}`);
    }
    return entry;
  });
  // The console field calls JSON.parse and then validates RuntimeProfileContext[];
  // this round trip catches non-JSON convenience syntax before documentation ships.
  if (!Array.isArray(JSON.parse(JSON.stringify(resolved)))) {
    throw new Error(`${recipeId} does not resolve to a JSON array`);
  }
}

const standardEngineering = catalogue.recipes['standard-engineering@v1'];
if (
  !standardEngineering ||
  requiredStandardEngineeringFragments.some(
    (fragment) => !standardEngineering.fragments.includes(fragment),
  )
) {
  throw new Error(
    'standard-engineering@v1 must retain the documented workflow ownership fragments',
  );
}

console.log(
  `Validated ${Object.keys(catalogue.recipes).length} runtime-profile context recipes.`,
);
