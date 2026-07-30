import type { Agent } from '@themoltnet/sdk';

import {
  MAX_CONTEXT_FILES_PER_TOPIC,
  MAX_CONTEXT_OWNERS_PER_FILE,
  MAX_PRIMARY_FILES_PER_TOPIC,
  MAX_SINGLETON_TOPIC_BYTES,
  MAX_SPECIALIST_TASKS,
  MAX_TOPIC_BYTES,
  MAX_TOPICS,
} from './topic-plan.js';
import type {
  CoverageLedger,
  ModelFileExclusion,
  ReviewArtifactRecord,
  ReviewFileRecord,
  ReviewFileStatus,
  ReviewLane,
  ReviewManifest,
  ReviewPreflight,
} from './types.js';

export const MAX_RAW_DIFF_BYTES = 2 * 1024 * 1024;
export const MAX_REVIEW_FILES = 200;
export const PLANNER_FILE_THRESHOLD = 25;
export const PLANNER_LOC_THRESHOLD = 1_500;
export const PLANNER_BYTE_THRESHOLD = 64 * 1024;
export const REVIEW_MANIFEST_TITLE = 'review-manifest.v1.json';
export const REVIEW_MANIFEST_CONTENT_TYPE =
  'application/vnd.themoltnet.review-manifest+json;version=1';
export const REVIEW_FILE_CONTENT_TYPE = 'text/x-diff';
const LARGE_REVIEW_STAGE_INTERVAL_MS = 1_000;

export interface GitHubFileMetadata {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface ParsedReviewFile extends ReviewFileRecord {
  patch: string;
}

export interface ParsedReviewInput extends Omit<ReviewPreflight, 'files'> {
  files: ParsedReviewFile[];
}

export interface PrintableReviewPreflight extends ReviewPreflight {
  limits: {
    rawDiffBytes: number;
    files: number;
    topics: number;
    primaryFilesPerTopic: number;
    contextFilesPerTopic: number;
    contextOwnersPerFile: number;
    topicBytes: number;
    singletonTopicBytes: number;
    specialistTasks: number;
  };
  planningThresholds: {
    files: number;
    changedLoc: number;
    reviewableBytes: number;
  };
}

function decodeGitPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"')) return trimmed;
  if (!trimmed.endsWith('"')) {
    throw new Error(`malformed quoted git path: ${value}`);
  }
  const body = trimmed.slice(1, -1);
  const bytes: number[] = [];
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char !== '\\') {
      bytes.push(...Buffer.from(char, 'utf8'));
      continue;
    }
    const escaped = body[++index];
    if (escaped === undefined)
      throw new Error(`malformed git escape: ${value}`);
    const simple: Record<string, number> = {
      a: 7,
      b: 8,
      t: 9,
      n: 10,
      v: 11,
      f: 12,
      r: 13,
      '"': 34,
      '\\': 92,
    };
    if (simple[escaped] !== undefined) {
      bytes.push(simple[escaped]);
      continue;
    }
    if (/[0-7]/.test(escaped)) {
      let octal = escaped;
      for (
        let count = 0;
        count < 2 && /[0-7]/.test(body[index + 1] ?? '');
        count += 1
      ) {
        octal += body[++index];
      }
      bytes.push(Number.parseInt(octal, 8));
      continue;
    }
    bytes.push(...Buffer.from(escaped, 'utf8'));
  }
  return Buffer.from(bytes).toString('utf8');
}

function parseHeaderPaths(line: string): [string, string] {
  const source = line.slice('diff --git '.length);
  const tokens: string[] = [];
  let current = '';
  let quoted = false;
  let escaped = false;
  for (const char of source) {
    if (escaped) {
      current += `\\${char}`;
      escaped = false;
    } else if (char === '\\' && quoted) {
      escaped = true;
    } else if (char === '"') {
      quoted = !quoted;
      current += char;
    } else if (char === ' ' && !quoted) {
      if (current) tokens.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  if (quoted || tokens.length !== 2) {
    throw new Error(`malformed diff header: ${line}`);
  }
  return tokens.map((token) => decodeGitPath(token).replace(/^[ab]\//, '')) as [
    string,
    string,
  ];
}

function languageFor(path: string): string {
  const base = path.split('/').at(-1)?.toLowerCase() ?? '';
  const extension = base.includes('.') ? (base.split('.').at(-1) ?? '') : '';
  const byExtension: Record<string, string> = {
    c: 'c',
    cc: 'cpp',
    cpp: 'cpp',
    css: 'css',
    go: 'go',
    html: 'html',
    java: 'java',
    js: 'javascript',
    json: 'json',
    jsonc: 'json',
    jsx: 'javascript',
    md: 'markdown',
    mjs: 'javascript',
    py: 'python',
    rs: 'rust',
    sh: 'shell',
    sql: 'sql',
    ts: 'typescript',
    tsx: 'typescript',
    yaml: 'yaml',
    yml: 'yaml',
  };
  return (
    byExtension[extension] ?? (base === 'dockerfile' ? 'dockerfile' : 'text')
  );
}

function hasGeneratedHeader(patch: string): boolean {
  return patch
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .slice(0, 20)
    .some((line) =>
      /(?:code generated .* do not edit|auto-generated|automatically generated)/i.test(
        line,
      ),
    );
}

function classifyLanes(
  path: string,
  patch: string,
  language: string,
): ReviewLane[] {
  const normalizedPath = path.toLowerCase();
  const normalizedPatch = patch.toLowerCase();
  const haystack = `${normalizedPath}\n${normalizedPatch}`;
  const lanes = new Set<ReviewLane>(['correctness', 'dry-codebase-fit']);
  const code = !['markdown', 'text', 'json', 'yaml'].includes(language);
  const changedLines = patch
    .split('\n')
    .filter(
      (line) =>
        (line.startsWith('+') && !line.startsWith('+++')) ||
        (line.startsWith('-') && !line.startsWith('---')),
    ).length;
  const testLike =
    /(?:^|\/)__tests__(?:\/|$)|(?:^|[./_-])(?:test|tests|spec|e2e)(?:[./_-]|$)/.test(
      normalizedPath,
    ) || /\b(?:describe|it|test)\s*\(|\bexpect\s*\(/.test(normalizedPatch);

  if (testLike) {
    lanes.add('tests');
    return [...lanes];
  }

  if (
    /\b(?:auth(?:entication|orization)?|credential|cryptograph(?:y|ic)|crypto|secret|token|session|permission|policy|oauth|password|signature|attestation|sandbox|capabilit(?:y|ies))\b/.test(
      haystack,
    )
  ) {
    lanes.add('security');
  }
  if (
    /\b(?:performance|latency|throughput|cache|batch|stream|queue|worker|pool)\b/.test(
      haystack,
    ) ||
    (language === 'sql' &&
      /\b(?:select|insert|update|delete|join|index|constraint)\b/.test(
        normalizedPatch,
      ))
  ) {
    lanes.add('performance');
  }
  if (
    /\b(?:schema|migration|exports?|public|api|route|contract|config|workflow)\b/.test(
      haystack,
    ) ||
    /(?:^|\/)(?:package\.json|dockerfile)$|\.ya?ml$/.test(normalizedPath)
  ) {
    lanes.add('design-api-backcompat');
  }
  if (
    /\b(?:workflow|docker|infra|deploy|logger|logging|metric|trace|otel|retry|timeout|queue|daemon)\b/.test(
      haystack,
    )
  ) {
    lanes.add('operability');
  }
  if (code && changedLines >= 120) {
    lanes.add('tests');
    lanes.add('readability');
  }
  return [...lanes];
}

function normalizedStatus(
  status: string | undefined,
  lines: string[],
): ReviewFileStatus {
  switch (status) {
    case 'added':
    case 'modified':
    case 'deleted':
    case 'renamed':
    case 'copied':
      return status;
    default:
      if (lines.some((line) => line.startsWith('new file mode ')))
        return 'added';
      if (lines.some((line) => line.startsWith('deleted file mode ')))
        return 'deleted';
      if (lines.some((line) => line.startsWith('rename from ')))
        return 'renamed';
      if (lines.some((line) => line.startsWith('copy from '))) return 'copied';
      return 'modified';
  }
}

function hunkCounts(
  lines: string[],
  path: string,
): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  let remainingOld = 0;
  let remainingNew = 0;
  let inHunk = false;
  const finishHunk = () => {
    if (inHunk && (remainingOld !== 0 || remainingNew !== 0)) {
      throw new Error(`malformed or truncated diff hunk for ${path}`);
    }
  };
  for (const line of lines) {
    const header = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (header) {
      finishHunk();
      remainingOld = header[1] === undefined ? 1 : Number(header[1]);
      remainingNew = header[2] === undefined ? 1 : Number(header[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith('\\ No newline at end of file')) continue;
    if (line.startsWith('+')) {
      additions += 1;
      remainingNew -= 1;
    } else if (line.startsWith('-')) {
      deletions += 1;
      remainingOld -= 1;
    } else if (line.startsWith(' ')) {
      remainingOld -= 1;
      remainingNew -= 1;
    } else if (line.length === 0) {
      // split('\n') creates a trailing sentinel after the final newline.
      continue;
    }
    if (remainingOld < 0 || remainingNew < 0) {
      throw new Error(`malformed diff hunk counts for ${path}`);
    }
  }
  finishHunk();
  return { additions, deletions };
}

function emptyCoverage(files: ReviewFileRecord[]): CoverageLedger {
  const reviewableFiles = files
    .filter((file) => file.reviewable)
    .map((file) => file.path);
  return {
    reviewableFiles,
    excludedFiles: files
      .filter((file) => !file.reviewable)
      .map((file) => ({
        path: file.path,
        reason: file.exclusionReason ?? 'not-reviewable',
        source: 'intrinsic' as const,
      })),
    primaryOwners: Object.fromEntries(
      reviewableFiles.map((path) => [path, null]),
    ),
    laneCoverage: Object.fromEntries(reviewableFiles.map((path) => [path, []])),
    complete: reviewableFiles.length === 0,
  };
}

export function inspectReviewDiff(
  diff: string,
  githubFiles?: GitHubFileMetadata[],
): ParsedReviewInput {
  const rawDiffBytes = Buffer.byteLength(diff, 'utf8');
  if (rawDiffBytes > MAX_RAW_DIFF_BYTES) {
    throw new Error(
      `raw diff exceeds the ${MAX_RAW_DIFF_BYTES}-byte ingestion limit (got ${rawDiffBytes})`,
    );
  }
  const lines = diff.split('\n');
  const sections: Array<{ oldPath: string; newPath: string; lines: string[] }> =
    [];
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const [oldPath, newPath] = parseHeaderPaths(line);
      sections.push({ oldPath, newPath, lines: [line] });
    } else if (sections.length > 0) {
      sections.at(-1)?.lines.push(line);
    } else if (line.trim()) {
      throw new Error(
        'malformed diff: content appears before the first file header',
      );
    }
  }
  const metadataByPath = new Map(
    (githubFiles ?? []).map((file) => [file.filename, file]),
  );
  if (githubFiles && githubFiles.length > MAX_REVIEW_FILES) {
    throw new Error(
      `review contains ${githubFiles.length} files; limit is ${MAX_REVIEW_FILES}`,
    );
  }
  const files = sections.map((section): ParsedReviewFile => {
    const renameTo = section.lines.find((line) =>
      line.startsWith('rename to '),
    );
    const copyTo = section.lines.find((line) => line.startsWith('copy to '));
    const path = renameTo
      ? decodeGitPath(renameTo.slice('rename to '.length))
      : copyTo
        ? decodeGitPath(copyTo.slice('copy to '.length))
        : section.newPath;
    const metadata = metadataByPath.get(path);
    const binary = section.lines.some(
      (line) => line.startsWith('Binary files ') || line === 'GIT binary patch',
    );
    const counts = binary
      ? { additions: 0, deletions: 0 }
      : hunkCounts(section.lines, path);
    const additions = metadata?.additions ?? counts.additions;
    const deletions = metadata?.deletions ?? counts.deletions;
    const joinedPatch = section.lines.join('\n');
    const patch = joinedPatch.endsWith('\n') ? joinedPatch : `${joinedPatch}\n`;
    const language = languageFor(path);
    const generatedSignals = hasGeneratedHeader(patch)
      ? ['generated-header']
      : [];
    const exclusionReason = binary ? 'binary' : undefined;
    const previousPath =
      metadata?.previous_filename ??
      (path !== section.oldPath ? section.oldPath : undefined);
    return {
      path,
      ...(previousPath ? { previousPath } : {}),
      status: normalizedStatus(metadata?.status, section.lines),
      additions,
      deletions,
      changedLoc: metadata?.changes ?? additions + deletions,
      byteSize: Buffer.byteLength(patch, 'utf8'),
      language,
      binary,
      generated: false,
      generatedSignals,
      reviewable: exclusionReason === undefined,
      ...(exclusionReason ? { exclusionReason } : {}),
      requiredLanes:
        exclusionReason === undefined
          ? classifyLanes(path, patch, language)
          : [],
      patch,
    };
  });
  if (githubFiles) {
    const parsedPaths = new Set(files.map((file) => file.path));
    for (const metadata of githubFiles) {
      if (parsedPaths.has(metadata.filename)) continue;
      if (!metadata.patch) {
        throw new Error(
          `malformed or truncated diff: missing section for ${metadata.filename}`,
        );
      }
      throw new Error(
        `malformed diff: metadata path ${metadata.filename} was not found`,
      );
    }
  }
  if (files.length > MAX_REVIEW_FILES) {
    throw new Error(
      `review contains ${files.length} files; limit is ${MAX_REVIEW_FILES}`,
    );
  }
  const reviewable = files.filter((file) => file.reviewable);
  const reviewableBytes = reviewable.reduce(
    (total, file) => total + file.byteSize,
    0,
  );
  const changedLoc = reviewable.reduce(
    (total, file) => total + file.changedLoc,
    0,
  );
  return {
    version: 1,
    rawDiffBytes,
    totalFiles: files.length,
    reviewableFiles: reviewable.length,
    reviewableBytes,
    changedLoc,
    requiresPlanning:
      reviewable.length > PLANNER_FILE_THRESHOLD ||
      changedLoc > PLANNER_LOC_THRESHOLD ||
      reviewableBytes > PLANNER_BYTE_THRESHOLD,
    files,
    coverage: emptyCoverage(files),
  };
}

function artifactRecord(
  staged: { cid: string; contentType?: string; sizeBytes: number },
  title: string,
  contentType: string,
): ReviewArtifactRecord {
  return {
    cid: staged.cid,
    title,
    contentType: staged.contentType ?? contentType,
    sizeBytes: staged.sizeBytes,
  };
}

/** Run inspection first, then stage only immutable per-file review input. */
export async function stageReviewManifest(
  agent: Agent,
  teamId: string,
  inspected: ParsedReviewInput,
): Promise<ReviewManifest> {
  const stagedFiles: ReviewManifest['files'] = [];
  const pending = [...inspected.files];
  let stagedReviewableCount = 0;
  const stageNext = async (): Promise<void> => {
    while (pending.length > 0) {
      const file = pending.shift();
      if (!file) return;
      const { patch, ...record } = file;
      if (!record.reviewable) {
        stagedFiles.push(record);
        continue;
      }
      if (inspected.requiresPlanning && stagedReviewableCount > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, LARGE_REVIEW_STAGE_INTERVAL_MS);
        });
      }
      const title = `review-file:${record.path}`;
      const staged = await agent.tasks.artifacts.stage(
        Buffer.from(patch, 'utf8'),
        { contentType: REVIEW_FILE_CONTENT_TYPE },
        { teamId },
      );
      stagedFiles.push({
        ...record,
        artifact: artifactRecord(
          staged,
          title.slice(0, 255),
          REVIEW_FILE_CONTENT_TYPE,
        ),
      });
      stagedReviewableCount += 1;
    }
  };
  await stageNext();
  const order = new Map(
    inspected.files.map((file, index) => [file.path, index]),
  );
  stagedFiles.sort(
    (left, right) =>
      (order.get(left.path) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.path) ?? Number.MAX_SAFE_INTEGER),
  );
  const manifestBody = {
    ...inspected,
    files: stagedFiles,
  };
  const bytes = Buffer.from(JSON.stringify(manifestBody), 'utf8');
  const stagedManifest = await agent.tasks.artifacts.stage(
    bytes,
    { contentType: REVIEW_MANIFEST_CONTENT_TYPE },
    { teamId },
  );
  return {
    ...manifestBody,
    manifestArtifact: artifactRecord(
      stagedManifest,
      REVIEW_MANIFEST_TITLE,
      REVIEW_MANIFEST_CONTENT_TYPE,
    ),
  };
}

export function printablePreflight(
  inspected: ParsedReviewInput,
): PrintableReviewPreflight {
  return {
    ...inspected,
    files: inspected.files.map(({ patch: _patch, ...file }) => file),
    limits: {
      rawDiffBytes: MAX_RAW_DIFF_BYTES,
      files: MAX_REVIEW_FILES,
      topics: MAX_TOPICS,
      primaryFilesPerTopic: MAX_PRIMARY_FILES_PER_TOPIC,
      contextFilesPerTopic: MAX_CONTEXT_FILES_PER_TOPIC,
      contextOwnersPerFile: MAX_CONTEXT_OWNERS_PER_FILE,
      topicBytes: MAX_TOPIC_BYTES,
      singletonTopicBytes: MAX_SINGLETON_TOPIC_BYTES,
      specialistTasks: MAX_SPECIALIST_TASKS,
    },
    planningThresholds: {
      files: PLANNER_FILE_THRESHOLD,
      changedLoc: PLANNER_LOC_THRESHOLD,
      reviewableBytes: PLANNER_BYTE_THRESHOLD,
    },
  };
}

/**
 * Apply untrusted model classification only after validating exact paths and
 * evidence. Artifacts remain staged for auditability but are never bound to a
 * specialist once their file is excluded.
 */
export function applyModelExclusions(
  manifest: ReviewManifest,
  exclusions: ModelFileExclusion[],
): ReviewManifest {
  const known = new Map(manifest.files.map((file) => [file.path, file]));
  const paths = exclusions.map((exclusion) => exclusion.path);
  if (new Set(paths).size !== paths.length) {
    throw new Error('model exclusions contain duplicate paths');
  }
  for (const [index, exclusion] of exclusions.entries()) {
    const file = known.get(exclusion.path);
    if (!file) {
      throw new Error(
        `model exclusion ${index} references unknown file ${exclusion.path}`,
      );
    }
    if (!file.reviewable) {
      throw new Error(
        `model exclusion ${index} references intrinsically excluded file ${exclusion.path}`,
      );
    }
    if (!exclusion.reason.trim() || !exclusion.evidence.trim()) {
      throw new Error(
        `model exclusion ${index} requires a non-empty reason and evidence`,
      );
    }
    if (exclusion.reason.length > 500 || exclusion.evidence.length > 2_000) {
      throw new Error(`model exclusion ${index} exceeds diagnostic bounds`);
    }
  }
  const excluded = new Map(
    exclusions.map((exclusion) => [exclusion.path, exclusion]),
  );
  const files = manifest.files.map((file) => {
    const decision = excluded.get(file.path);
    return decision
      ? {
          ...file,
          generated: true,
          reviewable: false,
          exclusionReason: decision.reason,
          requiredLanes: [],
        }
      : file;
  });
  const reviewable = files.filter((file) => file.reviewable);
  const reviewablePaths = reviewable.map((file) => file.path);
  return {
    ...manifest,
    files,
    reviewableFiles: reviewable.length,
    reviewableBytes: reviewable.reduce(
      (total, file) => total + file.byteSize,
      0,
    ),
    changedLoc: reviewable.reduce((total, file) => total + file.changedLoc, 0),
    coverage: {
      reviewableFiles: reviewablePaths,
      excludedFiles: [
        ...manifest.coverage.excludedFiles.filter(
          (file) => file.source === 'intrinsic',
        ),
        ...exclusions.map((exclusion) => ({
          ...exclusion,
          source: 'model' as const,
        })),
      ],
      primaryOwners: Object.fromEntries(
        reviewablePaths.map((path) => [path, null]),
      ),
      laneCoverage: Object.fromEntries(
        reviewablePaths.map((path) => [path, []]),
      ),
      complete: reviewable.length === 0,
    },
  };
}
