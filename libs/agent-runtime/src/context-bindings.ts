import type { ContextRef, TaskContext } from '@moltnet/tasks';

const SLUG_PREFIX_LEN = 12;
const PROMPT_SEPARATOR = '\n\n---\n\n';

export interface FetchedBytes {
  cid: string;
  bytes: Uint8Array;
}

export type CidFetcher = (cid: string) => Promise<FetchedBytes>;

/**
 * Returns true when the bytes the fetcher returned hash to the
 * requested CID. The implementation lives outside this module so a
 * caller can plug in CIDv1-with-raw or CIDv1-with-dag-pb depending on
 * how it stored the bytes.
 */
export type CidVerifier = (got: FetchedBytes) => Promise<boolean>;

export interface FlaggedResult {
  flagged: boolean;
  reason?: string;
}

/**
 * #977 / #956 gate: refuse content that has been flagged for
 * `injection_risk` or that failed a fidelity judgment. Plug in the
 * caller's existing predicate; the resolver does not own the policy.
 */
export type FlaggedContentCheck = (got: FetchedBytes) => Promise<FlaggedResult>;

export interface ContextDeliverer {
  /** Persist skill bytes at the runtime's discovery path. */
  skill: (args: { slug: string; bytes: Uint8Array }) => Promise<void>;
}

export interface ResolveContextArgs {
  context: TaskContext;
  fetch: CidFetcher;
  verifyCid: CidVerifier;
  isFlagged: FlaggedContentCheck;
  deliver: ContextDeliverer;
}

export interface ResolvedContext {
  /** What was injected, in declared order. Audit log row per entry. */
  injected: ContextRef[];
  /** Prepended to the system prompt by the prompt assembler. */
  systemPromptPrefix: string;
  /** Appended to the first user message by the prompt assembler. */
  userInlineSuffix: string;
}

/**
 * Resolve `task.input.context[]` into delivered side-effects (skills
 * written to disk via `deliver.skill`) and prompt fragments
 * (`systemPromptPrefix`, `userInlineSuffix`) the caller weaves into the
 * built prompt.
 *
 * Per-binding semantics (V1):
 *   - `skill`         → `deliver.skill({ slug, bytes })` once per ref.
 *                       Slug = first 12 alphanumeric chars of CID;
 *                       collisions on distinct CIDs are refused loudly.
 *   - `prompt_prefix` → bytes appended to `systemPromptPrefix` with the
 *                       canonical `\n\n---\n\n` separator (in declared
 *                       order).
 *   - `user_inline`   → bytes appended to `userInlineSuffix` in declared
 *                       order, same separator.
 *
 * Refusal modes (each throws):
 *   - `verifyCid` returns false (CID mismatch);
 *   - `isFlagged` returns `flagged: true` (caller-supplied predicate);
 *   - skill slug collides with a different CID already used.
 *
 * The function is pure with respect to its arguments: file writes and
 * fetches are confined to the injected callbacks, which makes the
 * resolver trivial to test.
 */
export async function resolveTaskContext(
  args: ResolveContextArgs,
): Promise<ResolvedContext> {
  const promptParts: string[] = [];
  const userParts: string[] = [];
  const injected: ContextRef[] = [];
  const usedSlugs = new Map<string, string>();

  for (const ref of args.context) {
    const got = await args.fetch(ref.cid);
    if (!(await args.verifyCid(got))) {
      throw new Error(`cid mismatch for ${ref.cid}`);
    }
    const flag = await args.isFlagged(got);
    if (flag.flagged) {
      throw new Error(
        `context ${ref.cid} flagged (${flag.reason ?? 'unknown'})`,
      );
    }

    switch (ref.binding) {
      case 'skill': {
        const slug = deriveSlug(ref.cid);
        const prior = usedSlugs.get(slug);
        if (prior !== undefined && prior !== ref.cid) {
          throw new Error(
            `slug collision: ${slug} already used by ${prior}; refusing to overwrite`,
          );
        }
        usedSlugs.set(slug, ref.cid);
        await args.deliver.skill({ slug, bytes: got.bytes });
        break;
      }
      case 'prompt_prefix':
        promptParts.push(new TextDecoder().decode(got.bytes));
        break;
      case 'user_inline':
        userParts.push(new TextDecoder().decode(got.bytes));
        break;
    }
    injected.push(ref);
  }

  return {
    injected,
    systemPromptPrefix: promptParts.join(PROMPT_SEPARATOR),
    userInlineSuffix: userParts.join(PROMPT_SEPARATOR),
  };
}

/**
 * First 12 alphanumeric chars of the CID. Non-alphanumerics are
 * stripped defensively even though CIDs are base32 — keeps the slug
 * usable as a directory name on every supported FS.
 */
function deriveSlug(cid: string): string {
  return cid.replace(/[^a-zA-Z0-9]/g, '').slice(0, SLUG_PREFIX_LEN);
}
