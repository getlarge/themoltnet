import type {
  SkillEvalTask,
  SkillScoreContext,
  SkillScorer,
} from '@moltnet/context-evals';
import { runShellCommand } from '@moltnet/context-evals/process';
import type { Agent } from '@themoltnet/sdk';
import { connect } from '@themoltnet/sdk';

import { scoreChainTiers } from './chain-scorer.js';
import type { CommitExpected, CommitScoreResult } from './types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DiaryEntryInfo {
  id: string;
  entryType: string;
  tags: string[];
  content: string;
  signatureValid: boolean;
}

export interface ScoreInput {
  commitMessages: string[];
  diaryEntries: DiaryEntryInfo[];
  expected: CommitExpected;
}

// ── Pure scoring function (testable without I/O) ──────────────────────────────

export function scoreCommitTiers(input: ScoreInput): CommitScoreResult {
  const { commitMessages, diaryEntries } = input;
  const details: string[] = [];

  const check = (tier: string, ok: boolean, pass: string, fail: string) => {
    details.push(`[${tier}] ${ok ? pass : fail}`);
    return ok;
  };

  // ── Must-have (60%) ──────────────────────────────────────────
  const hasDiaryEntry = check(
    'must',
    diaryEntries.length > 0,
    'Diary entry exists',
    'No diary entry found',
  );

  const hasTrailer = check(
    'must',
    commitMessages.some((msg) => /MoltNet-Diary:\s*\S+/.test(msg)),
    'MoltNet-Diary trailer present',
    'Missing MoltNet-Diary trailer',
  );

  // Extract trailer IDs and verify at least one matches a fetched diary entry
  const diaryEntryIds = new Set(diaryEntries.map((e) => e.id));
  const trailerIds = commitMessages.flatMap((msg) => {
    const match = msg.match(/MoltNet-Diary:\s*(\S+)/);
    return match ? [match[1]] : [];
  });
  const trailerMatchesEntry = check(
    'must',
    trailerIds.some((id) => diaryEntryIds.has(id)),
    'MoltNet-Diary trailer ID matches a fetched diary entry',
    `Trailer IDs [${trailerIds.join(', ')}] do not match any diary entry IDs [${[...diaryEntryIds].join(', ')}]`,
  );

  const mustHave = hasDiaryEntry && hasTrailer && trailerMatchesEntry;

  // ── Should-have (30%) ────────────────────────────────────────
  let shouldHave = false;
  if (mustHave && diaryEntries.length > 0) {
    const entry = diaryEntries[0];

    const hasAccountableTag = check(
      'should',
      entry.tags.includes('accountable-commit'),
      'accountable-commit tag',
      `Missing accountable-commit tag (found: ${entry.tags.join(', ')})`,
    );

    const hasRiskTag = check(
      'should',
      entry.tags.some((t) => t.startsWith('risk:')),
      'risk:<level> tag present',
      'Missing risk:<level> tag',
    );

    const hasBranchTag = check(
      'should',
      entry.tags.some((t) => t.startsWith('branch:')),
      'branch:<branch> tag present',
      'Missing branch:<branch> tag',
    );

    const isProcedural = check(
      'should',
      entry.entryType === 'procedural',
      'entry_type is procedural',
      `entry_type is "${entry.entryType}" (expected procedural)`,
    );

    shouldHave =
      hasAccountableTag && hasRiskTag && hasBranchTag && isProcedural;
  }

  // ── Nice-to-have (10%) ───────────────────────────────────────
  let niceToHave = false;
  if (shouldHave && diaryEntries.length > 0) {
    const entry = diaryEntries[0];

    const hasSig = check(
      'nice',
      entry.signatureValid,
      'Signature valid',
      'Signature missing or invalid',
    );

    const hasMetadata = check(
      'nice',
      /\brefs:/.test(entry.content) &&
        /\boperator:/.test(entry.content) &&
        /\btool:/.test(entry.content) &&
        /\btimestamp:/.test(entry.content),
      'Metadata block complete',
      'Metadata block incomplete',
    );

    niceToHave = hasSig && hasMetadata;
  }

  const total =
    (mustHave ? 0.6 : 0) + (shouldHave ? 0.3 : 0) + (niceToHave ? 0.1 : 0);

  return {
    total,
    tiers: { mustHave, shouldHave, niceToHave },
    details,
    commitMessages,
    diaryEntryIds: diaryEntries.map((e) => e.id),
    diaryEntryContent: diaryEntries.map((e) => e.content),
  };
}

// ── I/O helpers ───────────────────────────────────────────────────────────────

export async function fetchCommitData(
  worktreeDir: string,
  sdk: Agent,
  diaryId?: string,
  baseCommit?: string,
): Promise<{ commitMessages: string[]; diaryEntries: DiaryEntryInfo[] }> {
  // 1. Get commit messages (only commits added after baseCommit)
  const range = baseCommit ? `${baseCommit}..HEAD` : '-10';
  const gitLog = await runShellCommand(
    `git log --format="%B---COMMIT_SEP---" ${range}`,
    worktreeDir,
    30_000,
  );
  const commitMessages = gitLog.output
    .split('---COMMIT_SEP---')
    .map((m) => m.trim())
    .filter(Boolean);

  // 2. Extract trailer IDs from commit messages and fetch those entries directly.
  //    The previous approach (list last 10 accountable-commit entries) broke under
  //    GEPA because entry accumulation across rounds pushed the current entry out
  //    of the limit window.
  const trailerIds = commitMessages.flatMap((msg) => {
    const match = msg.match(/MoltNet-Diary:\s*(\S+)/);
    return match ? [match[1]] : [];
  });

  const entryMap = new Map<
    string,
    { id: string; entryType: string; tags: string[]; content: string }
  >();

  const normalizeEntry = (entry: {
    id: string;
    entryType: string;
    tags: string[] | null;
    content: string;
  }) => ({
    id: entry.id,
    entryType: entry.entryType,
    tags: entry.tags ?? [],
    content: entry.content,
  });

  // Fetch each trailer-referenced entry by ID (parallel)
  await Promise.all(
    trailerIds.map(async (id) => {
      try {
        const entry = await sdk.entries.get(id);
        entryMap.set(entry.id, normalizeEntry(entry));
      } catch {
        // Entry may not exist (agent failed to create it)
      }
    }),
  );

  // No fallback listing — only score entries explicitly referenced by
  // MoltNet-Diary trailers. The previous entries.list fallback pulled in
  // entries from other GEPA rounds and prior eval runs, inflating
  // diaryEntries counts and breaking chain scoring.

  // 3. Verify signatures via SDK
  const diaryEntries: DiaryEntryInfo[] = await Promise.all(
    [...entryMap.values()].map(async (entry) => {
      let signatureValid = false;
      try {
        const verifyResult = await sdk.entries.verify(entry.id);
        signatureValid = verifyResult.valid === true;
      } catch {
        // signature verification failed
      }
      return {
        id: entry.id,
        entryType: entry.entryType,
        tags: entry.tags ?? [],
        content: entry.content,
        signatureValid,
      };
    }),
  );

  return { commitMessages, diaryEntries };
}

// ── Full scorer ───────────────────────────────────────────────────────────────

export class CommitScorer implements SkillScorer<
  CommitExpected,
  CommitScoreResult
> {
  private readonly sdkPromise: Promise<Agent>;
  private readonly diaryId: string;

  constructor(
    apiBaseUrl: string,
    diaryId: string,
    clientId: string,
    clientSecret: string,
  ) {
    this.diaryId = diaryId;
    this.sdkPromise = connect({
      clientId,
      clientSecret,
      apiUrl: apiBaseUrl,
    });
  }

  async score(
    worktreeDir: string,
    expected: CommitExpected,
    context: SkillScoreContext,
  ): Promise<CommitScoreResult> {
    const sdk = await this.sdkPromise;
    const { commitMessages, diaryEntries } = await fetchCommitData(
      worktreeDir,
      sdk,
      this.diaryId,
      context.baseCommit,
    );

    if (expected.isChain) {
      return scoreChainTiers({ commitMessages, diaryEntries, expected });
    }
    return scoreCommitTiers({ commitMessages, diaryEntries, expected });
  }

  toNumeric(result: CommitScoreResult): number {
    return result.total;
  }

  toFeedback(result: CommitScoreResult, _task: SkillEvalTask): string {
    const sections: string[] = [];

    const failedByTier = (tier: string) =>
      result.details.filter(
        (d) => d.startsWith(`[${tier}]`) && !d.includes('✓'),
      );

    if (!result.tiers.mustHave) {
      const failed = failedByTier('must');
      if (failed.length > 0) {
        sections.push('MUST-HAVE FAILED:', ...failed.map((d) => `  ${d}`));
      }
    }
    if (!result.tiers.shouldHave) {
      const failed = failedByTier('should');
      if (failed.length > 0) {
        sections.push('SHOULD-HAVE FAILED:', ...failed.map((d) => `  ${d}`));
      }
    }
    if (!result.tiers.niceToHave) {
      const failed = failedByTier('nice');
      if (failed.length > 0) {
        sections.push('NICE-TO-HAVE FAILED:', ...failed.map((d) => `  ${d}`));
      }
    }

    if (result.commitMessages.length > 0) {
      sections.push(
        `\nACTUAL COMMIT MESSAGE:\n${result.commitMessages[0].slice(0, 500)}`,
      );
    }

    if (result.diaryEntryContent.length > 0) {
      sections.push(
        `\nACTUAL ENTRY CONTENT (truncated):\n${result.diaryEntryContent[0].slice(0, 500)}`,
      );
    }

    return sections.join('\n');
  }
}
