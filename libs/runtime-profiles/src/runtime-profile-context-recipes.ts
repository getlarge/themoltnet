/**
 * Versioned catalogue of starter runtime-profile context recipes.
 *
 * A recipe is a named, versioned bundle of context `fragments` — each a full
 * {@link ContextRef} — that an operator can apply to a runtime profile as
 * ordinary, editable context entries. Recipes carry no runtime identity: applying
 * one copies its fragments into the profile's `context` array and nothing else,
 * so the saved profile is indistinguishable from one an operator typed by hand.
 *
 * This is the single source of truth shared by the console and the docs, both of
 * which consume it from the browser-safe `@moltnet/tasks/context-recipes` subpath.
 * Fragment `content` is validated against the same {@link ContextRef} schema
 * profiles use — see runtime-profile-context-recipes.test.ts.
 */
import type { ContextRef } from './context.js';

// Re-exported so browser consumers (docs, console) can import the entry type and
// the content-length bound from this lean subpath without pulling the full
// @moltnet/tasks barrel (which carries server task schemas).
export type { ContextRef } from './context.js';
export { CONTEXT_REF_MAX_CONTENT_LENGTH } from './context.js';

export interface RuntimeProfileContextRecipe {
  /** One-line operator-facing summary of what the recipe installs. */
  description: string;
  /** Fragment ids, applied in order. Each must exist in `fragments`. */
  fragments: string[];
}

export interface RuntimeProfileContextCatalogue {
  /** Catalogue schema version. Bumped when the recipe/fragment shape changes. */
  version: number;
  /** Reusable context entries, keyed by (and self-identifying via) their slug. */
  fragments: Record<string, ContextRef>;
  /** Named, versioned recipes keyed `<name>@v<N>`. */
  recipes: Record<string, RuntimeProfileContextRecipe>;
}

export const RUNTIME_PROFILE_CONTEXT_CATALOGUE: RuntimeProfileContextCatalogue =
  {
    version: 1,
    fragments: {
      'artifact-planner-v1': {
        binding: 'prompt_prefix',
        content:
          '# Bounded artifact planner\n\n- The typed task facts, embedded bounded manifest, exact bound artifact references, registered tools, and runtime capability section are the complete contract. Do not search diaries, inspect a mounted repository, enumerate unrelated tasks or artifacts, modify a checkout, commit, branch, push, or contact GitHub.\n- Read only the exact artifact CIDs named by the task, and only when the embedded manifest does not provide enough evidence. Use the registered task-artifact tools for artifact access; never use shell or CLI wrappers to fetch artifacts, paginate, or discover them speculatively.\n- If the effective runtime exposes a local calculator or shell, use it only inside scratch for coverage accounting, budget arithmetic, and JSON validation. The runtime capability section and policy are authoritative; do not assume a static executable list.\n- Perform semantic classification and planning from supplied content and producer/consumer evidence. Do not substitute filename, directory, language, ecosystem, or repository-specific exclusion rules for evidence.\n- Write and upload exactly the requested versioned plan artifact, then reference its returned metadata through the registered submit-output tool. Do not emit a second prose or JSON representation.',
        slug: 'artifact-planner-v1',
      },
      'accountable-delivery-v1': {
        binding: 'prompt_prefix',
        content:
          '# Accountable delivery\n\n- Pair every commit made during this task with a signed diary entry created by the `moltnet_create_entry` custom tool. Put the returned id in a `MoltNet-Diary: <id>` commit trailer.\n- Keep commit signing enabled; do not bypass the agent git configuration.\n- Push a branch and open or update a pull request only when the task asks for it. For GitHub mutations, use the credential-bound `GH_TOKEN` command form required by the runtime kernel.\n- Keep changes, commits, and any requested pull request coherent enough to review independently.',
        slug: 'accountable-delivery-v1',
      },
      'judgment-diary-v1': {
        binding: 'prompt_prefix',
        content:
          '# Judgment diary discipline\n\n- For an `assess_brief`, `judge_pack`, or `pr_review` task, create a signed diary entry with the `moltnet_create_entry` custom tool before submitting the structured judgment. Capture the rationale and evidence that support the verdict.\n- Add the `judgment` tag and the active task type tag (`assess_brief`, `judge_pack`, or `pr_review`). For `judge_pack`, also add `rubric:<rubricId>` from the task facts.\n- Do not use a shell `moltnet entry` command: task provenance is injected only by the custom tool.',
        slug: 'judgment-diary-v1',
      },
      'proactive-memory-v1': {
        binding: 'prompt_prefix',
        content:
          '# Proactive memory use\n\n- Before non-trivial investigation, debugging, code changes, or review, check the task diary for relevant prior knowledge instead of waiting for a human to ask. Use `moltnet_diary_tags` for cheap reconnaissance, `moltnet_list_entries` when tags or task provenance are known, and `moltnet_search_entries` for semantic similarity. Do not search randomly: pass `taskFilter` for task-local or correlation-local queries, and pass `tags` / `entryTypes` for broader prior-knowledge queries using known tags such as `incident`, `decision`, or `scope:<area>`. Broaden only after constrained searches miss.\n- Before creating an `episodic` incident entry, search for similar incidents using the proposed title, root cause, error text, affected subsystem, and watch-for terms, filtered by `entryTypes: ["episodic", "semantic"]` and any known `scope:*` or task-provenance tags. If a close prior match exists, do not create an isolated duplicate: reference the prior entry in your response or diary content, update or link it when the new occurrence adds material evidence, or create a new recurrence entry only when the recurrence itself is important signal.\n- When you create a recurrence entry, include the prior matching entry id(s) in the content and explain what is new about this occurrence.',
        slug: 'proactive-memory-v1',
      },
      'run-eval-direct-v1': {
        binding: 'prompt_prefix',
        content:
          '# Direct evaluation run\n\nThe supplied scenario, typed task facts, injected context, and registered submit-output tool are the complete task contract. Do not search diaries, create diary entries, modify a repository, commit, branch, push, or open a pull request unless a task fact explicitly requires it. Submit the agent-authored payload in the first turn; correction turns exist only to recover a rejected or missing submission.',
        slug: 'run-eval-direct-v1',
      },
      'task-diary-discipline-v1': {
        binding: 'prompt_prefix',
        content:
          "# Task diary discipline\n\n- During a daemon task, create diary entries only through the `moltnet_create_entry` custom tool. It binds entries to the current task diary and injects task, type, attempt, and correlation provenance tags.\n- Do not shell out to `moltnet entry create`, `moltnet entry create-signed`, or any other `moltnet entry` subcommand from bash while a task is running. Those paths bypass the custom tool's task-tag injection, so task-filtered diary queries cannot find the entry.\n- You may add useful tags, but do not try to replace task provenance supplied by the runtime.",
        slug: 'task-diary-discipline-v1',
      },
      'verification-and-artifacts-v1': {
        binding: 'prompt_prefix',
        content:
          '# Verification and artifacts\n\n- Run relevant verification before submitting. When task facts include `successCriteria`, assess them honestly in the generated verification contract; a fail or skip with evidence is better than a fabricated pass.\n- The registered submit-output tool owns the exact agent submission schema and validation recovery. Use that schema; do not invent a JSON shape in prose.\n- Upload only task-relevant artifacts, and inspect each before uploading. Never upload secrets, credentials, API keys, auth tokens or headers, .env files, or personal or customer data; redact sensitive values, and prefer minimal, sanitized excerpts over whole logs, bundles, or datasets. Include artifact metadata only where the typed submit contract permits it.\n- If the task depends on prior artifacts, list and download the exact referenced artifact before judging or continuing that work.',
        slug: 'verification-and-artifacts-v1',
      },
    },
    recipes: {
      'artifact-planner@v1': {
        description:
          'Minimal artifact-only context for bounded semantic classification and planning.',
        fragments: ['artifact-planner-v1'],
      },
      'run-eval-direct@v1': {
        description:
          'Minimal direct context for a short, isolated evaluation run.',
        fragments: ['run-eval-direct-v1'],
      },
      'standard-engineering@v1': {
        description:
          'Full opt-in operating guidance for engineering tasks that need diary research, accountable delivery, and verification discipline.',
        fragments: [
          'proactive-memory-v1',
          'task-diary-discipline-v1',
          'accountable-delivery-v1',
          'judgment-diary-v1',
          'verification-and-artifacts-v1',
        ],
      },
    },
  };

// The catalogue is a process-wide singleton. Deep-freeze it so a consumer cannot
// mutate fragment/recipe state and change later resolutions; the resolver also
// hands back cloned entries (below) so applied context is always caller-owned.
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
deepFreeze(RUNTIME_PROFILE_CONTEXT_CATALOGUE);

/** Recipe ids (`<name>@v<N>`) available to apply, in catalogue order. */
export const runtimeProfileContextRecipeIds: readonly string[] = Object.freeze(
  Object.keys(RUNTIME_PROFILE_CONTEXT_CATALOGUE.recipes),
);

/**
 * Resolve a recipe id into the ordered {@link ContextRef} entries it installs.
 * Returns fresh, caller-owned copies so applying a recipe cannot alias — let
 * alone mutate — the shared catalogue. Throws if the recipe id or any referenced
 * fragment is unknown.
 */
export function resolveRuntimeProfileContextRecipe(
  recipeId: string,
): ContextRef[] {
  const recipe = RUNTIME_PROFILE_CONTEXT_CATALOGUE.recipes[recipeId];
  if (!recipe) {
    throw new Error(`Unknown runtime-profile context recipe: ${recipeId}`);
  }
  return recipe.fragments.map((fragmentId) => {
    const fragment = RUNTIME_PROFILE_CONTEXT_CATALOGUE.fragments[fragmentId];
    if (!fragment) {
      throw new Error(
        `Runtime-profile context recipe ${recipeId} references missing fragment ${fragmentId}`,
      );
    }
    return { ...fragment };
  });
}

/** One-line description for a recipe id. Throws if the recipe id is unknown. */
export function runtimeProfileContextRecipeDescription(
  recipeId: string,
): string {
  const recipe = RUNTIME_PROFILE_CONTEXT_CATALOGUE.recipes[recipeId];
  if (!recipe) {
    throw new Error(`Unknown runtime-profile context recipe: ${recipeId}`);
  }
  return recipe.description;
}
