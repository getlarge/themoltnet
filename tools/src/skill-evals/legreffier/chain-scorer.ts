import type { DiaryEntryInfo } from './commit-scorer.js';
import type { CommitExpected, CommitScoreResult } from './types.js';

export interface ChainScoreInput {
  commitMessages: string[];
  diaryEntries: DiaryEntryInfo[];
  expected: CommitExpected;
}

export function scoreChainTiers(input: ChainScoreInput): CommitScoreResult {
  const { commitMessages, diaryEntries, expected } = input;
  const expectedCount = expected.expectedCommitCount ?? commitMessages.length;
  const details: string[] = [];

  // ── Must-have (60%): each commit has a diary entry + trailer ───
  const traileredCommits = commitMessages.filter((msg) =>
    /MoltNet-Diary:\s*\S+/.test(msg),
  );
  const trailerRatio = commitMessages.length
    ? traileredCommits.length / expectedCount
    : 0;
  details.push(
    `${traileredCommits.length}/${expectedCount} commits have MoltNet-Diary trailer`,
  );

  const entryRatio = diaryEntries.length
    ? Math.min(diaryEntries.length / expectedCount, 1)
    : 0;
  details.push(`${diaryEntries.length}/${expectedCount} diary entries found`);

  const mustHave = trailerRatio >= 1 && entryRatio >= 1;

  // ── Should-have (30%): proper tags + types on all entries ──────
  let shouldHave = false;
  if (mustHave) {
    const allProperlyTagged = diaryEntries.every(
      (e) =>
        e.tags.includes('accountable-commit') &&
        e.tags.some((t) => t.startsWith('risk:')) &&
        e.tags.some((t) => t.startsWith('branch:')) &&
        e.entryType === 'procedural',
    );
    details.push(
      allProperlyTagged
        ? 'All entries have correct tags and type'
        : 'Some entries missing required tags or wrong type',
    );

    const hasTaskGroup = commitMessages.some((msg) =>
      /Task-Group:\s*\S+/.test(msg),
    );
    details.push(
      hasTaskGroup
        ? 'Task-Group trailer present'
        : 'Missing Task-Group trailer',
    );

    const hasTaskCompletes = commitMessages.some((msg) =>
      /Task-Completes:\s*true/.test(msg),
    );
    details.push(
      hasTaskCompletes
        ? 'Task-Completes trailer present'
        : 'Missing Task-Completes trailer',
    );

    shouldHave = allProperlyTagged && hasTaskGroup && hasTaskCompletes;
  }

  // ── Nice-to-have (10%): signatures valid + metadata complete ───
  let niceToHave = false;
  if (shouldHave) {
    const allSigned = diaryEntries.every((e) => e.signatureValid);
    details.push(
      allSigned
        ? 'All entries have valid signatures'
        : 'Some entries missing valid signatures',
    );

    const allMetadata = diaryEntries.every(
      (e) =>
        /\brefs:/.test(e.content) &&
        /\boperator:/.test(e.content) &&
        /\btool:/.test(e.content) &&
        /\btimestamp:/.test(e.content),
    );
    details.push(
      allMetadata
        ? 'All entries have complete metadata'
        : 'Some entries have incomplete metadata',
    );

    niceToHave = allSigned && allMetadata;
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
