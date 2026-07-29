import {
  type DesignPreflight,
  type GlobalVerdict,
  type LaneFinding,
  type LaneResult,
  type ModelFileExclusion,
  REVIEW_LANES,
  type ReviewLane,
  type TopicVerdict,
} from './types.js';

function jsonObject(summary: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(summary);
  } catch {
    throw new Error(`${label} output must be strict JSON`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} output must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    throw new Error(`${label} contains unknown fields: ${extras.join(', ')}`);
  }
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const field = value[key];
  if (typeof field !== 'string' || !field.trim()) {
    throw new Error(`${label}.${key} must be a non-empty string`);
  }
  return field;
}

function strings(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || !item.trim())
  ) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  return value as string[];
}

function findings(value: unknown, label: string): LaneFinding[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${label}[${index}] must be an object`);
    }
    const finding = item as Record<string, unknown>;
    exactKeys(
      finding,
      ['severity', 'path', 'location', 'description', 'impact', 'fix'],
      `${label}[${index}]`,
    );
    if (
      !['blocker', 'major', 'minor', 'nit'].includes(String(finding.severity))
    ) {
      throw new Error(`${label}[${index}].severity is invalid`);
    }
    return {
      severity: finding.severity as LaneFinding['severity'],
      path: requiredString(finding, 'path', `${label}[${index}]`),
      ...(finding.location === undefined
        ? {}
        : {
            location: requiredString(finding, 'location', `${label}[${index}]`),
          }),
      description: requiredString(finding, 'description', `${label}[${index}]`),
      impact: requiredString(finding, 'impact', `${label}[${index}]`),
      fix: requiredString(finding, 'fix', `${label}[${index}]`),
    };
  });
}

function recommendation(
  value: unknown,
  label: string,
): GlobalVerdict['recommendation'] {
  if (
    value !== 'approve' &&
    value !== 'approve-with-nits' &&
    value !== 'request-changes'
  ) {
    throw new Error(`${label} recommendation is invalid`);
  }
  return value;
}

export function parseDesignPreflight(summary: string): DesignPreflight {
  const value = jsonObject(summary, 'design preflight');
  exactKeys(
    value,
    ['verdict', 'summary', 'questions', 'excludedFiles'],
    'design preflight',
  );
  if (
    value.verdict !== 'PROCEED' &&
    value.verdict !== 'PIVOT' &&
    value.verdict !== 'ASK'
  ) {
    throw new Error('design preflight verdict is invalid');
  }
  const questions =
    value.questions === undefined
      ? undefined
      : strings(value.questions, 'design preflight.questions');
  if (value.verdict === 'ASK' && (!questions || questions.length === 0)) {
    throw new Error('ASK preflight requires questions');
  }
  if ((questions?.length ?? 0) > 3) {
    throw new Error('design preflight supports at most 3 questions');
  }
  if (!Array.isArray(value.excludedFiles)) {
    throw new Error('design preflight.excludedFiles must be an array');
  }
  const excludedFiles = value.excludedFiles.map(
    (item, index): ModelFileExclusion => {
      const exclusion =
        item && typeof item === 'object' && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : null;
      if (!exclusion) {
        throw new Error(
          `design preflight.excludedFiles[${index}] must be an object`,
        );
      }
      exactKeys(
        exclusion,
        ['path', 'reason', 'evidence'],
        `design preflight.excludedFiles[${index}]`,
      );
      return {
        path: requiredString(
          exclusion,
          'path',
          `design preflight.excludedFiles[${index}]`,
        ),
        reason: requiredString(
          exclusion,
          'reason',
          `design preflight.excludedFiles[${index}]`,
        ),
        evidence: requiredString(
          exclusion,
          'evidence',
          `design preflight.excludedFiles[${index}]`,
        ),
      };
    },
  );
  return {
    verdict: value.verdict,
    summary: requiredString(value, 'summary', 'design preflight'),
    ...(questions ? { questions } : {}),
    excludedFiles,
  };
}

export function parseLaneResult(
  summary: string,
  expectedTopic: string,
  expectedLane: ReviewLane,
): LaneResult {
  const value = jsonObject(summary, 'lane result');
  exactKeys(
    value,
    ['version', 'topicId', 'lane', 'findings', 'reviewedFiles', 'summary'],
    'lane result',
  );
  if (value.version !== 1) throw new Error('lane result version must be 1');
  if (value.topicId !== expectedTopic) {
    throw new Error(`lane result topicId must be ${expectedTopic}`);
  }
  if (value.lane !== expectedLane || !REVIEW_LANES.includes(expectedLane)) {
    throw new Error(`lane result lane must be ${expectedLane}`);
  }
  return {
    version: 1,
    topicId: expectedTopic,
    lane: expectedLane,
    findings: findings(value.findings, 'lane result.findings'),
    reviewedFiles: strings(value.reviewedFiles, 'lane result.reviewedFiles'),
    summary: requiredString(value, 'summary', 'lane result'),
  };
}

export function parseTopicVerdict(
  summary: string,
  expectedTopic: string,
): TopicVerdict {
  const value = jsonObject(summary, 'topic verdict');
  exactKeys(
    value,
    [
      'version',
      'topicId',
      'recommendation',
      'findings',
      'coveredFiles',
      'coveredLanes',
      'summary',
    ],
    'topic verdict',
  );
  if (value.version !== 1) throw new Error('topic verdict version must be 1');
  if (value.topicId !== expectedTopic) {
    throw new Error(`topic verdict topicId must be ${expectedTopic}`);
  }
  const coveredLanes = strings(
    value.coveredLanes,
    'topic verdict.coveredLanes',
  );
  if (coveredLanes.some((lane) => !REVIEW_LANES.includes(lane as ReviewLane))) {
    throw new Error('topic verdict includes an unknown covered lane');
  }
  return {
    version: 1,
    topicId: expectedTopic,
    recommendation: recommendation(value.recommendation, 'topic verdict'),
    findings: findings(value.findings, 'topic verdict.findings'),
    coveredFiles: strings(value.coveredFiles, 'topic verdict.coveredFiles'),
    coveredLanes: coveredLanes as ReviewLane[],
    summary: requiredString(value, 'summary', 'topic verdict'),
  };
}

export function parseGlobalVerdict(summary: string): GlobalVerdict {
  const value = jsonObject(summary, 'global verdict');
  exactKeys(
    value,
    ['version', 'recommendation', 'findings', 'summary', 'coverageComplete'],
    'global verdict',
  );
  if (value.version !== 1) throw new Error('global verdict version must be 1');
  if (typeof value.coverageComplete !== 'boolean') {
    throw new Error('global verdict.coverageComplete must be boolean');
  }
  return {
    version: 1,
    recommendation: recommendation(value.recommendation, 'global verdict'),
    findings: findings(value.findings, 'global verdict.findings'),
    summary: requiredString(value, 'summary', 'global verdict'),
    coverageComplete: value.coverageComplete,
  };
}
