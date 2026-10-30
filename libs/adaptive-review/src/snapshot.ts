import { createHash } from 'node:crypto';

import { canonicalJson } from '@moltnet/crypto-service';
import type { Git } from '@moltnet/docs-impact-review';

import type { ChangedPath } from './core.js';
import { loadReviewGuidance, type ReviewGuidance } from './guidance.js';
import { type AdaptivePolicy, parseAdaptivePolicy } from './policy.js';

export const ADAPTIVE_POLICY_PATH = '.github/adaptive-review.json';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface PolicySnapshot {
  policy: AdaptivePolicy;
  digest: string;
  referenceDigests: Record<string, string>;
  source: string;
  guidance: ReviewGuidance[];
}

/** Missing policy means opt-out; malformed policy and missing references fail. */
export function loadAdaptivePolicy(
  git: Git,
  base: string,
): PolicySnapshot | null {
  if (!/^[0-9a-f]{40}$/.test(base)) throw new Error('invalid policy base OID');
  const listed = git([
    'ls-tree',
    '--full-tree',
    '--name-only',
    base,
    '--',
    ADAPTIVE_POLICY_PATH,
  ]).trim();
  if (!listed) return null;
  const raw = git(['show', `${base}:${ADAPTIVE_POLICY_PATH}`]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON in ${ADAPTIVE_POLICY_PATH}@${base}`);
  }
  const policy = parseAdaptivePolicy(parsed);
  const referenceDigests: Record<string, string> = {};
  const references = [
    ...(policy.lanes.includes('docs') && policy.docs
      ? [policy.docs.config]
      : []),
    ...(policy.lanes.includes('complexity') && policy.complexity
      ? [policy.complexity.rubric]
      : []),
  ];
  for (const path of references) {
    const found = git([
      'ls-tree',
      '--full-tree',
      '--name-only',
      base,
      '--',
      path,
    ]).trim();
    if (!found)
      throw new Error(`missing adaptive policy reference: ${path}@${base}`);
    referenceDigests[path] = sha256(git(['show', `${base}:${path}`]));
  }
  const guidance = loadReviewGuidance(git, base);
  for (const document of guidance)
    referenceDigests[document.path] = document.digest;
  return {
    policy,
    guidance,
    digest: sha256(
      canonicalJson(
        guidance.length
          ? {
              policy,
              guidance: guidance.map(({ path, digest }) => ({ path, digest })),
            }
          : policy,
      ),
    ),
    referenceDigests,
    source: `${ADAPTIVE_POLICY_PATH}@${base}`,
  };
}

/** Status and both rename paths survive evidence omission and patch summarizing. */
export function changedPaths(
  git: Git,
  base: string,
  head: string,
): ChangedPath[] {
  const fields = git([
    'diff',
    '--no-ext-diff',
    '--find-renames',
    '--name-status',
    '-z',
    `${base}...${head}`,
  ]).split('\0');
  const changes: ChangedPath[] = [];
  for (let index = 0; index < fields.length && fields[index]; ) {
    const code = fields[index++];
    const kind = code[0];
    if (kind === 'R' || kind === 'C') {
      const previousPath = fields[index++];
      const path = fields[index++];
      if (!previousPath || !path)
        throw new Error('incomplete renamed path manifest');
      changes.push({
        status: kind === 'R' ? 'renamed' : 'copied',
        previousPath,
        path,
      });
      continue;
    }
    const path = fields[index++];
    if (!path) throw new Error('incomplete changed path manifest');
    const status = {
      A: 'added',
      M: 'modified',
      D: 'deleted',
      T: 'typechanged',
    }[kind] as ChangedPath['status'] | undefined;
    if (!status) throw new Error(`unsupported changed path status: ${code}`);
    changes.push({ status, path });
  }
  return changes;
}
