import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  filterCandidatePrs,
  ghIssueBody,
  ghPrFiles,
  ghPrList,
  gitMergeBase,
  isTestFile,
  PACE_DELAY_MS,
  parseLinkedIssue,
} from './gh-client.js';
import type { HarvestOptions, HarvestState, PrCandidate } from './types.js';

// ── State persistence ──

export async function loadHarvestState(
  stateFile: string,
): Promise<HarvestState> {
  try {
    await access(stateFile);
    return JSON.parse(await readFile(stateFile, 'utf8')) as HarvestState;
  } catch {
    return { processed_prs: [], last_run: new Date().toISOString() };
  }
}

export async function saveHarvestState(
  stateFile: string,
  state: HarvestState,
): Promise<void> {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify(state, null, 2));
}

// ── Candidate building ──

export function buildPrCandidate(
  raw: {
    number: number;
    title: string;
    body: string;
    baseRefName: string;
    headRefOid: string;
    mergeCommitOid: string;
    labels: string[];
    closedAt: string;
    files: Array<{ path: string }>;
  },
  fixtureRef: string,
  linkedIssueBody: string | undefined,
): PrCandidate {
  const allFiles = raw.files.map((f) => f.path);
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body,
    baseRefName: raw.baseRefName,
    headRefOid: raw.headRefOid,
    mergeCommitOid: raw.mergeCommitOid,
    labels: raw.labels,
    closedAt: raw.closedAt,
    changedFiles: allFiles,
    changedTestFiles: allFiles.filter(isTestFile),
    fixtureRef,
    goldFixRef: raw.mergeCommitOid,
    linkedIssueBody,
  };
}

// ── Discovery pipeline ──

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function discoverCandidates(
  repoRoot: string,
  options: HarvestOptions,
): Promise<{ candidates: PrCandidate[]; state: HarvestState }> {
  const stateFile = resolve(repoRoot, 'tasksmith', 'state.json');
  const state = await loadHarvestState(stateFile);
  const processed = new Set(state.processed_prs);

  // Step 1: list merged PRs
  // eslint-disable-next-line no-console
  console.log('[discovery] Fetching merged PRs...');
  const rawPrs = await ghPrList(200);

  // Step 2: fetch file lists per PR (with pacing)
  // eslint-disable-next-line no-console
  console.log(`[discovery] Fetching file lists for ${rawPrs.length} PRs...`);
  for (const pr of rawPrs) {
    if (!pr.files) {
      try {
        const files = await ghPrFiles(pr.number);
        (pr as unknown as Record<string, unknown>).files = files;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn(
          `[discovery] Failed to fetch files for PR #${pr.number}: ${msg}`,
        );
        state.errors = { ...state.errors, [pr.number]: msg };
        (pr as unknown as Record<string, unknown>).files = [];
      }
      await sleep(PACE_DELAY_MS);
    }
  }

  // Step 3: filter
  const filtered = filterCandidatePrs(rawPrs);

  // Step 4: apply --prs filter and skip already-processed (unless --force)
  let selected = filtered;
  if (options.prs?.length) {
    const prSet = new Set(options.prs);
    selected = selected.filter((pr) => prSet.has(pr.number));
  }
  if (!options.force) {
    selected = selected.filter((pr) => !processed.has(pr.number));
  }

  // eslint-disable-next-line no-console
  console.log(
    `[discovery] ${rawPrs.length} merged PRs → ${filtered.length} candidates → ${selected.length} to process`,
  );

  // Step 5: compute refs and build PrCandidate[]
  const candidates: PrCandidate[] = [];
  for (const pr of selected) {
    try {
      const fixtureRef = await gitMergeBase('main', pr.headRefOid);
      const issueNum = parseLinkedIssue(pr.body);
      const issueBody = issueNum ? await ghIssueBody(issueNum) : undefined;

      candidates.push(
        buildPrCandidate(
          {
            ...pr,
            mergeCommitOid: pr.mergeCommit!.oid,
            labels: pr.labels.map((l: { name: string }) => l.name),
            files: (pr.files ?? []) as Array<{ path: string }>,
          },
          fixtureRef,
          issueBody,
        ),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(`[discovery] Failed to process PR #${pr.number}: ${msg}`);
      state.errors = { ...state.errors, [pr.number]: msg };
    }
    await sleep(PACE_DELAY_MS);
  }

  return { candidates, state };
}
