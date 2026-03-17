import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  filterCandidatePrs,
  ghIssueBody,
  ghPrFiles,
  ghPrList,
  ghPrView,
  gitFirstParent,
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

  // Step 1: fetch PRs — either targeted (--prs) or rolling list
  // When --prs is specified, fetch each PR directly so we don't miss PRs
  // outside the most recent 200 merged.
  // eslint-disable-next-line no-console
  console.log('[discovery] Fetching merged PRs...');

  let rawPrs: Awaited<ReturnType<typeof ghPrList>>;
  if (options.prs?.length) {
    rawPrs = [];
    for (const prNum of options.prs) {
      try {
        const pr = await ghPrView(prNum);
        rawPrs.push(pr);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn(`[discovery] Failed to fetch PR #${prNum}: ${msg}`);
        state.errors = { ...state.errors, [prNum]: msg };
      }
      await sleep(PACE_DELAY_MS);
    }
  } else {
    rawPrs = await ghPrList(200);

    // Fetch file lists per PR that don't already have them (with pacing)
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
  }

  // Step 2: filter candidates
  const filtered = filterCandidatePrs(rawPrs);

  // Step 3: skip already-processed (unless --force)
  let selected = filtered;
  if (!options.force) {
    selected = selected.filter((pr) => !processed.has(pr.number));
  }

  // eslint-disable-next-line no-console
  console.log(
    `[discovery] ${rawPrs.length} merged PRs → ${filtered.length} candidates → ${selected.length} to process`,
  );

  // Step 4: compute refs and build PrCandidate[]
  // fixture_ref = first parent of the merge commit (pre-merge main state).
  // Using merge-base(main, headRefOid) is wrong for merge commits because
  // headRefOid is already reachable from main, resolving to itself.
  const candidates: PrCandidate[] = [];
  for (const pr of selected) {
    try {
      const mergeOid = pr.mergeCommit!.oid;
      const fixtureRef = await gitFirstParent(mergeOid);
      const issueNum = parseLinkedIssue(pr.body);
      const issueBody = issueNum ? await ghIssueBody(issueNum) : undefined;

      candidates.push(
        buildPrCandidate(
          {
            ...pr,
            mergeCommitOid: mergeOid,
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
