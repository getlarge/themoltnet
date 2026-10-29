import type { EvidenceResult, Revision } from './contracts.js';
import type { GithubRequest } from './github-coordination.js';

/** Captured by the trusted CI dispatcher, never reconstructed from a green badge. */
export interface GithubCheckBinding {
  revision: Revision;
  repository: string;
  suiteId: number;
  appId: number;
  /** Logical policy name -> exact provider check name. */
  checks: Record<string, string>;
}

/** Read the latest attempt in a pinned suite; absent checks remain absent. */
export async function readGithubChecks(
  binding: GithubCheckBinding,
  request: GithubRequest,
): Promise<Record<string, EvidenceResult>> {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(binding.repository) ||
    !Number.isSafeInteger(binding.suiteId) ||
    binding.suiteId <= 0 ||
    !Number.isSafeInteger(binding.appId) ||
    binding.appId <= 0 ||
    Object.entries(binding.checks).some(
      ([key, name]) => !key.trim() || !name.trim(),
    )
  )
    throw new Error('Invalid CI evidence binding');
  const path = `/repos/${binding.repository}/check-suites/${binding.suiteId}`;
  const suite = object(await request(path, 'GET'));
  if (
    suite.id !== binding.suiteId ||
    suite.head_sha !== binding.revision.head ||
    object(suite.app).id !== binding.appId
  )
    throw new Error('CI suite does not match dispatch binding');
  const found = new Map<string, Record<string, unknown>[]>();
  const ids = new Set<number>();
  let total: number | undefined;
  for (let page = 1; ; page += 1) {
    if (page > 100) throw new Error('Incomplete CI evidence pagination');
    const response = object(
      await request(
        `${path}/check-runs?filter=latest&per_page=100&page=${page}`,
        'GET',
      ),
    );
    if (
      !Number.isSafeInteger(response.total_count) ||
      Number(response.total_count) < 0 ||
      !Array.isArray(response.check_runs) ||
      response.check_runs.length > 100
    )
      throw new Error('Invalid CI evidence page');
    if (total !== undefined && response.total_count !== total)
      throw new Error('CI evidence changed during pagination');
    total = Number(response.total_count);
    for (const raw of response.check_runs) {
      const run = object(raw);
      if (
        typeof run.id !== 'number' ||
        !Number.isSafeInteger(run.id) ||
        ids.has(run.id) ||
        typeof run.name !== 'string' ||
        run.head_sha !== binding.revision.head ||
        object(run.app).id !== binding.appId ||
        object(run.check_suite).id !== binding.suiteId
      )
        throw new Error('Invalid or unstable CI check identity');
      ids.add(run.id);
      found.set(run.name, [...(found.get(run.name) ?? []), run]);
    }
    if (response.check_runs.length < 100) break;
  }
  if (ids.size !== total) throw new Error('Incomplete CI evidence coverage');
  return Object.fromEntries(
    Object.entries(binding.checks).flatMap(([key, name]) => {
      const runs = found.get(name);
      if (!runs) return [];
      // Do not pick a convenient green check when names are ambiguous.
      const status = runs.length === 1 ? checkStatus(runs[0]) : 'incomplete';
      return [[key, { revision: binding.revision, status }]];
    }),
  );
}

function checkStatus(run: Record<string, unknown>): EvidenceResult['status'] {
  if (
    ['queued', 'in_progress', 'waiting', 'requested', 'pending'].includes(
      String(run.status),
    )
  )
    return 'pending';
  if (run.status !== 'completed') return 'incomplete';
  if (run.conclusion === 'success') return 'passed';
  if (
    ['failure', 'timed_out', 'action_required'].includes(String(run.conclusion))
  )
    return 'failed';
  // Skipped, neutral, cancelled, stale, and unknown are not proof of a passing check.
  return 'incomplete';
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid CI evidence response');
  return value as Record<string, unknown>;
}
