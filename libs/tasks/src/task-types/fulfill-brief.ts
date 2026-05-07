/**
 * `fulfill_brief` — produce a signed change against a coding brief.
 *
 * output_kind: artifact
 * criteria: optional (assessment happens as a separate `assess_brief` task)
 * references: optional (external GitHub issue/PR is the typical seed)
 */
import { type Static, Type } from '@sinclair/typebox';

import { SuccessCriteria } from '../success-criteria.js';

export const FULFILL_BRIEF_TYPE = 'fulfill_brief' as const;

export const FulfillBriefInput = Type.Object(
  {
    /** Human-readable problem statement. Rendered into the system prompt. */
    brief: Type.String({ minLength: 1 }),

    /** Optional title; defaults to a slug of `brief`. */
    title: Type.Optional(Type.String()),

    /**
     * Free-form acceptance criteria, interpreted by the claiming agent
     * during execution. Distinct from `successCriteria`, which is the
     * machine-verifiable envelope evaluated by the daemon at completion.
     * Plain prose — kept for backward compat and for hints the executor
     * cannot machine-check (e.g. "match the existing module's tone").
     */
    acceptanceCriteria: Type.Optional(Type.Array(Type.String())),

    /**
     * Imposer-stated, machine-verifiable success criteria. Pinned via
     * the task's `inputCid` (no separate hash needed — `successCriteria`
     * is part of the input body). Optional: when omitted, completion is
     * accepted on schema-valid output alone.
     */
    successCriteria: Type.Optional(SuccessCriteria),

    /**
     * Seed files the agent should read before starting. Paths relative
     * to the repo root. Optional — the agent is free to explore.
     */
    seedFiles: Type.Optional(Type.Array(Type.String())),

    /** Conventional commit scope hint (e.g. "tasks", "agent-runtime"). */
    scopeHint: Type.Optional(Type.String()),
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
          diaryEntryId: Type.Union([
            Type.String({ format: 'uuid' }),
            Type.Null(),
          ]),
        },
        { additionalProperties: false },
      ),
    ),

    /** PR URL if one was opened. Null if the attempt only pushed a branch. */
    pullRequestUrl: Type.Union([Type.String(), Type.Null()]),

    /** Diary entries produced during the attempt (ordered). */
    diaryEntryIds: Type.Array(Type.String({ format: 'uuid' })),

    /** 2–5 sentence summary the agent writes on completion. */
    summary: Type.String({ minLength: 1 }),
  },
  { $id: 'FulfillBriefOutput', additionalProperties: false },
);
export type FulfillBriefOutput = Static<typeof FulfillBriefOutput>;
