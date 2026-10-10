import { createHash } from 'node:crypto';

export const REVIEW_MARKER = '<!-- moltnet:security-review -->';
export const MAX_DIFF_BYTES = 120_000;

export function isRoutineDependencyUpdate(
  author: string,
  paths: readonly string[],
): boolean {
  return (
    /(?:^|-)renovate\[bot\]$/.test(author) &&
    paths.length > 0 &&
    paths.every(
      (path) =>
        /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lock|go\.mod|go\.sum|Cargo\.toml|Cargo\.lock)$/.test(
          path,
        ) ||
        path === 'pnpm-workspace.yaml' ||
        path === 'infra/otel/custom-collector/builder.yaml',
    )
  );
}

export interface Finding {
  id: string;
  status: 'confirmed' | 'unclear' | 'refuted';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  path: string;
  side: 'old' | 'new';
  line: number;
  title: string;
  evidence: string;
  reachability: string;
  remediation: string;
}

export interface ReviewResult {
  summary: string;
  findings: Finding[];
}

export const CANDIDATE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', minLength: 1 },
    findings: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
          path: { type: 'string', minLength: 1 },
          side: { type: 'string', enum: ['old', 'new'] },
          line: { type: 'integer', minimum: 1 },
          title: { type: 'string', minLength: 1 },
          hypothesis: { type: 'string', minLength: 1 },
        },
        required: ['id', 'path', 'side', 'line', 'title', 'hypothesis'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'findings'],
  additionalProperties: false,
} as const;

export const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', minLength: 1 },
    findings: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
          status: { type: 'string', enum: ['confirmed', 'unclear', 'refuted'] },
          severity: {
            type: 'string',
            enum: ['critical', 'high', 'medium', 'low', 'info'],
          },
          path: { type: 'string', minLength: 1 },
          side: { type: 'string', enum: ['old', 'new'] },
          line: { type: 'integer', minimum: 1 },
          title: { type: 'string', minLength: 1 },
          evidence: { type: 'string', minLength: 1 },
          reachability: { type: 'string', minLength: 1 },
          remediation: { type: 'string', minLength: 1 },
        },
        required: [
          'id',
          'status',
          'severity',
          'path',
          'side',
          'line',
          'title',
          'evidence',
          'reachability',
          'remediation',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'findings'],
  additionalProperties: false,
} as const;

export function changedLines(
  diff: string,
): Map<string, { old: Set<number>; new: Set<number> }> {
  const files = new Map<string, { old: Set<number>; new: Set<number> }>();
  let path: string | undefined;
  let oldPath: string | undefined;
  let oldLine = 0;
  let newLine = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      path = undefined;
      oldPath = undefined;
      continue;
    }
    if (line.startsWith('--- a/')) {
      oldPath = line.slice(6);
      continue;
    }
    if (line.startsWith('+++ b/')) {
      path = line.slice(6);
      files.set(path, { old: new Set(), new: new Set() });
      continue;
    }
    if (line === '+++ /dev/null' && oldPath) {
      path = oldPath;
      files.set(path, { old: new Set(), new: new Set() });
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (!path || line.startsWith('\\')) continue;
    if (line.startsWith('+')) files.get(path)?.new.add(newLine++);
    else if (line.startsWith('-')) files.get(path)?.old.add(oldLine++);
    else if (line.startsWith(' ')) {
      oldLine++;
      newLine++;
    }
  }
  return files;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('expected an object');
  return value as Record<string, unknown>;
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4000)
    throw new Error(`${label} must be a nonempty bounded string`);
  return value;
}

export interface Candidate {
  id: string;
  path: string;
  side: 'old' | 'new';
  line: number;
  title: string;
  hypothesis: string;
}

export function validateCandidates(value: unknown, diff: string): Candidate[] {
  const data = record(value);
  nonempty(data.summary, 'summary');
  if (!Array.isArray(data.findings) || data.findings.length > 30)
    throw new Error('findings must be an array of at most 30 candidates');
  const lines = changedLines(diff);
  const ids = new Set<string>();
  return data.findings.map((raw) => {
    const item = record(raw);
    const id = nonempty(item.id, 'candidate id');
    const path = nonempty(item.path, 'candidate path');
    const side = item.side;
    const line = item.line;
    if (side !== 'old' && side !== 'new')
      throw new Error(`invalid side for candidate ${id}`);
    if (
      ids.has(id) ||
      typeof line !== 'number' ||
      !Number.isInteger(line) ||
      !lines.get(path)?.[side].has(line)
    )
      throw new Error(
        `candidate ${id} must have a unique id and cite a changed diff line`,
      );
    ids.add(id);
    return {
      id,
      path,
      side,
      line,
      title: nonempty(item.title, 'title'),
      hypothesis: nonempty(item.hypothesis, 'hypothesis'),
    };
  });
}

export function validateResult(
  value: unknown,
  candidates: Candidate[],
  diff: string,
): ReviewResult {
  const data = record(value);
  const summary = nonempty(data.summary, 'summary');
  if (
    !Array.isArray(data.findings) ||
    data.findings.length !== candidates.length
  )
    throw new Error('validation must account for every candidate');
  const byId = new Map(candidates.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const lines = changedLines(diff);
  const findings = data.findings.map((raw): Finding => {
    const item = record(raw);
    const id = nonempty(item.id, 'finding id');
    const source = byId.get(id);
    if (!source || seen.has(id))
      throw new Error(`unknown or duplicate finding ${id}`);
    seen.add(id);
    const status = item.status;
    const severity = item.severity;
    const path = nonempty(item.path, 'finding path');
    const side = item.side;
    const line = item.line;
    if (status !== 'confirmed' && status !== 'unclear' && status !== 'refuted')
      throw new Error(`invalid status for ${id}`);
    if (
      !['critical', 'high', 'medium', 'low', 'info'].includes(String(severity))
    )
      throw new Error(`invalid severity for ${id}`);
    if (
      path !== source.path ||
      side !== source.side ||
      line !== source.line ||
      !lines.get(path)?.[source.side].has(line)
    )
      throw new Error(
        `finding ${id} does not cite its candidate's changed line`,
      );
    return {
      id,
      status,
      severity: severity as Finding['severity'],
      path,
      side: source.side,
      line,
      title: nonempty(item.title, 'title'),
      evidence: nonempty(item.evidence, 'evidence'),
      reachability: nonempty(item.reachability, 'reachability'),
      remediation: nonempty(item.remediation, 'remediation'),
    };
  });
  return { summary, findings };
}

export function correlationId(seed: string): string {
  const bytes = createHash('sha256').update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function renderComment(head: string, taskId: string): string {
  if (!/^[a-f0-9]{40}$/.test(head) || !/^[a-f0-9-]{36}$/.test(taskId))
    throw new Error('invalid review reference');
  return (
    `${REVIEW_MARKER}\n## Security review (advisory)\n\n` +
    `Review completed for head \`${head}\`. The detailed record is in the team-scoped MoltNet task \`${taskId}\`.\n\n` +
    'This advisory does not block the PR.'
  );
}
