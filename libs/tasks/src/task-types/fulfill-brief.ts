/**
 * `fulfill_brief` — produce a signed change against a coding brief.
 *
 * output_kind: artifact
 * criteria: optional (assessment happens as a separate `assess_brief` task)
 * references: optional (external GitHub issue/PR is the typical seed)
 */
import { type Static, Type } from '@sinclair/typebox';

export const FULFILL_BRIEF_TYPE = 'fulfill_brief' as const;

export const FulfillBriefInput = Type.Object(
  {
    /** Human-readable problem statement. Rendered into the system prompt. */
    brief: Type.String({ minLength: 1 }),

    /** Optional title; defaults to a slug of `brief`. */
    title: Type.Optional(Type.String()),

    /**
     * Optional structured acceptance criteria. Free-form — interpreted by
     * the claiming agent. Any formal rubric lives in a separate
     * `assess_brief` task, not here.
     */
    acceptance_criteria: Type.Optional(Type.Array(Type.String())),

    /**
     * Seed files the agent should read before starting. Paths relative
     * to the repo root. Optional — the agent is free to explore.
     */
    seed_files: Type.Optional(Type.Array(Type.String())),

    /** Conventional commit scope hint (e.g. "tasks", "agent-runtime"). */
    scope_hint: Type.Optional(Type.String()),
  },
  { $id: 'FulfillBriefInput', additionalProperties: false },
);
export type FulfillBriefInput = Static<typeof FulfillBriefInput>;

/**
 * Summary of the signed change. Individual commits / diary entries are
 * recoverable from git + the diary; this output is the index.
 */
export const FulfillBriefOutput = Type.Object(
  {
    /** Feature branch name the agent pushed to. */
    branch: Type.String({ minLength: 1 }),

    /** Ordered list of commit SHAs produced by this attempt. */
    commits: Type.Array(
      Type.Object(
        {
          sha: Type.String({ minLength: 7 }),
          message: Type.String(),
          diary_entry_id: Type.Union([
            Type.String({ format: 'uuid' }),
            Type.Null(),
          ]),
        },
        { additionalProperties: false },
      ),
    ),

    /** PR URL if one was opened. Null if the attempt only pushed a branch. */
    pull_request_url: Type.Union([Type.String(), Type.Null()]),

    /** Diary entries produced during the attempt (ordered). */
    diary_entry_ids: Type.Array(Type.String({ format: 'uuid' })),

    /** 2–5 sentence summary the agent writes on completion. */
    summary: Type.String({ minLength: 1 }),
  },
  { $id: 'FulfillBriefOutput', additionalProperties: false },
);
export type FulfillBriefOutput = Static<typeof FulfillBriefOutput>;
