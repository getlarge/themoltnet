import { createHash } from 'node:crypto';

import type { StageExecutorPolicy } from './brief.js';
import type { ConvergencePolicy } from './convergence.js';
import type { GithubDeliveryInput } from './github-moltnet.js';

type GithubPolicy = GithubDeliveryInput['github']['policy'];
export interface RepositoryPolicy {
  version: 1;
  repository: string;
  teamId: string;
  diaryId: string;
  appUserId: number;
  github: GithubPolicy;
  executors: { delivery: StageExecutorPolicy; assessment: StageExecutorPolicy };
  limits: {
    maxActiveCases: number;
    stageTimeoutSec: number;
    convergence: ConvergencePolicy;
  };
  evidence: {
    requiredChecks: string[];
    requiredLanes: string[];
    auditLanes: string[];
  };
}
export interface PolicySnapshot {
  policy: RepositoryPolicy;
  digest: string;
}

/** Normalize untrusted configuration before it can become durable stage input. */
export function parseRepositoryPolicy(value: unknown): PolicySnapshot {
  const root = object(value, [
    'version',
    'repository',
    'teamId',
    'diaryId',
    'appUserId',
    'github',
    'executors',
    'limits',
    'evidence',
  ]);
  if (root.version !== 1)
    throw new Error('Unsupported repository policy version');
  const repository = string(root.repository);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error('Invalid repository');
  const github = object(root.github, [
    'eligibleLabels',
    'approvalLabel',
    'pauseLabel',
    'cancelLabel',
    'allowedPermissions',
    'baseBranch',
    'allowedPaths',
    'protectedPaths',
    'labels',
    'deliveredStage',
  ]);
  const labels = object(github.labels, ['stages']);
  const stageNames = [
    'preparation',
    'delivery',
    'review',
    'ready',
    'needs-human',
    'paused',
    'cancelled',
  ];
  const stages = object(labels.stages, stageNames);
  const stageLabels = Object.fromEntries(
    stageNames.map((key) => [key, string(stages[key])]),
  );
  const controls = [
    string(github.approvalLabel),
    string(github.pauseLabel),
    string(github.cancelLabel),
  ];
  const eligibleLabels = strings(github.eligibleLabels);
  const allLabels = [
    ...Object.values(stageLabels),
    ...controls,
    ...eligibleLabels,
  ];
  if (
    new Set(allLabels.map((label) => label.toLowerCase())).size !==
    allLabels.length
  )
    throw new Error('Control, eligibility, and stage labels must be disjoint');
  const permissions = strings(github.allowedPermissions);
  if (
    permissions.some(
      (permission) => permission !== 'admin' && permission !== 'write',
    )
  )
    throw new Error('Admission requires write or admin permission');
  const deliveredStage = string(github.deliveredStage);
  if (!Object.hasOwn(stageLabels, deliveredStage))
    throw new Error('Unknown delivered stage');
  const executors = object(root.executors, ['delivery', 'assessment']);
  const limits = object(root.limits, [
    'maxActiveCases',
    'stageTimeoutSec',
    'convergence',
  ]);
  const convergence = object(limits.convergence, [
    'maxRepairRounds',
    'pollIntervalSec',
    'evidenceTimeoutSec',
    'repairTimeoutSec',
  ]);
  const evidence = object(root.evidence, [
    'requiredChecks',
    'requiredLanes',
    'auditLanes',
  ]);
  const policy: RepositoryPolicy = {
    version: 1,
    repository: repository.toLowerCase(),
    teamId: uuid(root.teamId),
    diaryId: uuid(root.diaryId),
    appUserId: integer(root.appUserId, 1, Number.MAX_SAFE_INTEGER),
    github: {
      eligibleLabels,
      approvalLabel: controls[0],
      pauseLabel: controls[1],
      cancelLabel: controls[2],
      allowedPermissions: permissions as ('admin' | 'write')[],
      baseBranch: string(github.baseBranch),
      allowedPaths: paths(github.allowedPaths),
      protectedPaths: paths(github.protectedPaths),
      labels: { stages: stageLabels },
      deliveredStage,
    },
    executors: {
      delivery: executor(executors.delivery),
      assessment: executor(executors.assessment),
    },
    limits: {
      maxActiveCases: integer(limits.maxActiveCases, 1, 2),
      stageTimeoutSec: integer(limits.stageTimeoutSec, 1, 86400),
      convergence: {
        maxRepairRounds: integer(convergence.maxRepairRounds, 0, 2),
        pollIntervalSec: integer(convergence.pollIntervalSec, 1, 3600),
        evidenceTimeoutSec: integer(convergence.evidenceTimeoutSec, 1, 86400),
        repairTimeoutSec: integer(convergence.repairTimeoutSec, 1, 86400),
      },
    },
    evidence: {
      requiredChecks: strings(evidence.requiredChecks),
      requiredLanes: strings(evidence.requiredLanes),
      auditLanes: strings(evidence.auditLanes),
    },
  };
  if (policy.limits.convergence.pollIntervalSec > policy.limits.stageTimeoutSec)
    throw new Error('Polling interval exceeds stage timeout');
  return {
    policy,
    digest: createHash('sha256').update(JSON.stringify(policy)).digest('hex'),
  };
}
function executor(value: unknown): StageExecutorPolicy {
  const item = object(value, [
    'profileId',
    'maxAttempts',
    'dispatchTimeoutSec',
    'runningTimeoutSec',
  ]);
  return {
    profileId: uuid(item.profileId),
    maxAttempts: integer(item.maxAttempts, 1, 3),
    dispatchTimeoutSec: integer(item.dispatchTimeoutSec, 1, 86400),
    runningTimeoutSec: integer(item.runningTimeoutSec, 1, 86400),
  };
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected policy object');
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(record, key))
  )
    throw new Error(`Expected exactly these policy fields: ${keys.join(', ')}`);
  return record;
}
function string(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error('Invalid policy string');
  return value;
}
function uuid(value: unknown): string {
  const result = string(value);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      result,
    )
  )
    throw new Error('Expected UUID');
  return result.toLowerCase();
}
function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error(`Expected integer in ${min}..${max}`);
  return value;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length)
    throw new Error('Expected nonempty policy list');
  const result = value.map(string);
  if (new Set(result).size !== result.length)
    throw new Error('Duplicate policy list value');
  return result;
}
function paths(value: unknown): string[] {
  const result = strings(value);
  if (
    result.some(
      (path) =>
        path.startsWith('/') ||
        ['\\', '*', '?', '[', ']', '{', '}'].some((character) =>
          path.includes(character),
        ) ||
        path.split('/').some((part) => part === '.' || part === '..') ||
        path.includes('//'),
    )
  )
    throw new Error(
      'Paths must be relative files or directory prefixes, without globs',
    );
  return result;
}
