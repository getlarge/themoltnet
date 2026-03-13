import type { SkillEvalTask, SkillScorer } from '@moltnet/context-evals';
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

  // ── Must-have (60%) ──────────────────────────────────────────
  const hasDiaryEntry = diaryEntries.length > 0;
  details.push(hasDiaryEntry ? 'Diary entry exists' : 'No diary entry found');

  const hasTrailer = commitMessages.some((msg) =>
    /MoltNet-Diary:\s*\S+/.test(msg),
  );
  details.push(
    hasTrailer
      ? 'MoltNet-Diary trailer present'
      : 'Missing MoltNet-Diary trailer',
  );

  const mustHave = hasDiaryEntry && hasTrailer;

  // ── Should-have (30%) ────────────────────────────────────────
  let shouldHave = false;
  if (mustHave && diaryEntries.length > 0) {
    const entry = diaryEntries[0];

    const hasAccountableTag = entry.tags.includes('accountable-commit');
    details.push(
      hasAccountableTag
        ? 'accountable-commit tag'
        : `Missing accountable-commit tag (found: ${entry.tags.join(', ')})`,
    );

    const hasRiskTag = entry.tags.some((t) => t.startsWith('risk:'));
    details.push(
      hasRiskTag ? 'risk:<level> tag present' : 'Missing risk:<level> tag',
    );

    const hasBranchTag = entry.tags.some((t) => t.startsWith('branch:'));
    details.push(
      hasBranchTag
        ? 'branch:<branch> tag present'
        : 'Missing branch:<branch> tag',
    );

    const isProcedural = entry.entryType === 'procedural';
    details.push(
      isProcedural
        ? 'entry_type is procedural'
        : `entry_type is "${entry.entryType}" (expected procedural)`,
    );

    shouldHave =
      hasAccountableTag && hasRiskTag && hasBranchTag && isProcedural;
  }

  // ── Nice-to-have (10%) ───────────────────────────────────────
  let niceToHave = false;
  if (shouldHave && diaryEntries.length > 0) {
    const entry = diaryEntries[0];

    const hasSig = entry.signatureValid;
    details.push(hasSig ? 'Signature valid' : 'Signature missing or invalid');

    const hasMetadata =
      /\brefs:/.test(entry.content) &&
      /\boperator:/.test(entry.content) &&
      /\btool:/.test(entry.content) &&
      /\btimestamp:/.test(entry.content);
    details.push(
      hasMetadata ? 'Metadata block complete' : 'Metadata block incomplete',
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
  diaryId: string,
): Promise<{ commitMessages: string[]; diaryEntries: DiaryEntryInfo[] }> {
  // 1. Get commit messages
  const gitLog = await runShellCommand(
    'git log --format="%B---COMMIT_SEP---" -10',
    worktreeDir,
    30_000,
  );
  const commitMessages = gitLog.output
    .split('---COMMIT_SEP---')
    .map((m) => m.trim())
    .filter(Boolean);

  // 2. List diary entries via SDK (token management + 429 retry)
  const entriesData = await sdk.entries.list(diaryId, {
    tags: 'accountable-commit',
    limit: 10,
  });

  // 3. Verify signatures via SDK
  const diaryEntries: DiaryEntryInfo[] = await Promise.all(
    (entriesData.items ?? []).map(async (entry) => {
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
  ): Promise<CommitScoreResult> {
    const sdk = await this.sdkPromise;
    const { commitMessages, diaryEntries } = await fetchCommitData(
      worktreeDir,
      sdk,
      this.diaryId,
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

    if (!result.tiers.mustHave) {
      const failed = result.details
        .slice(0, 2)
        .filter((d) => d.includes('No diary') || d.includes('Missing MoltNet'));
      if (failed.length > 0) {
        sections.push('MUST-HAVE FAILED:', ...failed.map((d) => `  ${d}`));
      }
    }
    if (!result.tiers.shouldHave) {
      const failed = result.details
        .slice(2, 6)
        .filter((d) => d.startsWith('Missing') || d.startsWith('entry_type'));
      if (failed.length > 0) {
        sections.push('SHOULD-HAVE FAILED:', ...failed.map((d) => `  ${d}`));
      }
    }
    if (!result.tiers.niceToHave) {
      const failed = result.details
        .slice(6)
        .filter((d) => d.startsWith('Signature') || d.startsWith('Metadata'));
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
