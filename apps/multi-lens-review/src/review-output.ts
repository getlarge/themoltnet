import type { TaskClient } from '@themoltnet/tasks-orchestrator';

import {
  assertExactKeys,
  nonEmptyStringArray,
  parseStrictJsonObject,
  requiredNonEmptyString,
  strictRecord,
} from './strict-json.js';
import {
  type AcceptedReviewOutputReference,
  type DesignPreflight,
  type GlobalVerdict,
  type LaneFinding,
  type LaneResult,
  type MultiLensReviewDurableOutput,
  type MultiLensReviewPublishedOutput,
  REVIEW_LANES,
  type ReviewLane,
  type TopicReviewResult,
  type TopicVerdict,
} from './types.js';

async function acceptedOutput(
  tasks: TaskClient,
  reference: AcceptedReviewOutputReference,
): Promise<unknown> {
  const task = await tasks.getTask(reference.taskId);
  if (
    task.status !== 'completed' ||
    task.acceptedAttemptN !== reference.attemptN
  ) {
    throw new Error(
      `referenced task ${reference.taskId} no longer has accepted attempt ${reference.attemptN}`,
    );
  }
  const attempts = await tasks.listAttempts(reference.taskId);
  const attempt = attempts.find(
    (candidate) => candidate.attemptN === reference.attemptN,
  );
  if (
    !attempt ||
    attempt.status !== 'completed' ||
    attempt.outputCid !== reference.outputCid
  ) {
    throw new Error(
      `referenced task ${reference.taskId} output CID does not match accepted attempt ${reference.attemptN}`,
    );
  }
  return attempt.output;
}

function outputSummary(output: unknown, label: string): string {
  const summary = (output as { summary?: unknown } | null)?.summary;
  if (typeof summary !== 'string' || summary.length === 0) {
    throw new Error(`${label} accepted output is missing a summary`);
  }
  return summary;
}

/**
 * Hydrate only the phase bodies needed for presentation after Absurd has
 * returned its compact reference envelope.
 */
export async function hydrateMultiLensReviewOutput(
  output: MultiLensReviewDurableOutput,
  tasks: TaskClient,
): Promise<MultiLensReviewPublishedOutput> {
  const preflightReference = output.phaseOutputs.preflight;
  const synthesisReference = output.phaseOutputs.globalSynthesis;
  const preflight = preflightReference
    ? parseDesignPreflight(
        outputSummary(
          await acceptedOutput(tasks, preflightReference),
          'design preflight',
        ),
      )
    : undefined;
  const verdict = synthesisReference
    ? parseGlobalVerdict(
        outputSummary(
          await acceptedOutput(tasks, synthesisReference),
          'global synthesis',
        ),
      )
    : output.outcome === 'completed' &&
        output.diagnostics.coverage.reviewableFiles.length === 0
      ? {
          version: 1 as const,
          recommendation: 'approve-with-nits' as const,
          findings: [],
          summary: 'No agent-reviewable files remain.',
          coverageComplete: true,
        }
      : undefined;
  return {
    ...output,
    ...(preflight ? { preflight } : {}),
    ...(verdict ? { verdict } : {}),
  };
}

function findings(value: unknown, label: string): LaneFinding[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => {
    const finding = strictRecord(item, `${label}[${index}]`);
    assertExactKeys(
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
      path: requiredNonEmptyString(finding, 'path', `${label}[${index}]`),
      ...(finding.location === undefined
        ? {}
        : {
            location: requiredNonEmptyString(
              finding,
              'location',
              `${label}[${index}]`,
            ),
          }),
      description: requiredNonEmptyString(
        finding,
        'description',
        `${label}[${index}]`,
      ),
      impact: requiredNonEmptyString(finding, 'impact', `${label}[${index}]`),
      fix: requiredNonEmptyString(finding, 'fix', `${label}[${index}]`),
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
  const value = parseStrictJsonObject(summary, 'design preflight output');
  assertExactKeys(
    value,
    ['verdict', 'summary', 'questions'],
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
      : nonEmptyStringArray(value.questions, 'design preflight.questions');
  if (value.verdict === 'ASK' && (!questions || questions.length === 0)) {
    throw new Error('ASK preflight requires questions');
  }
  if ((questions?.length ?? 0) > 3) {
    throw new Error('design preflight supports at most 3 questions');
  }
  return {
    verdict: value.verdict,
    summary: requiredNonEmptyString(value, 'summary', 'design preflight'),
    ...(questions ? { questions } : {}),
  };
}

export function parseLaneResult(
  summary: string,
  expectedTopic: string,
  expectedLane: ReviewLane,
): LaneResult {
  const value = parseStrictJsonObject(summary, 'lane result output');
  assertExactKeys(
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
    reviewedFiles: nonEmptyStringArray(
      value.reviewedFiles,
      'lane result.reviewedFiles',
    ),
    summary: requiredNonEmptyString(value, 'summary', 'lane result'),
  };
}

export function parseTopicReviewResult(
  summary: string,
  expectedTopic: string,
  expectedLanes: readonly ReviewLane[],
): TopicReviewResult {
  const value = parseStrictJsonObject(summary, 'topic review result output');
  assertExactKeys(
    value,
    ['version', 'topicId', 'laneResults'],
    'topic review result',
  );
  if (value.version !== 1) {
    throw new Error('topic review result version must be 1');
  }
  if (value.topicId !== expectedTopic) {
    throw new Error(`topic review result topicId must be ${expectedTopic}`);
  }
  if (!Array.isArray(value.laneResults)) {
    throw new Error('topic review result.laneResults must be an array');
  }
  const actualLanes = value.laneResults.map((item, index) => {
    const candidate =
      item && typeof item === 'object' && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : null;
    if (!candidate || typeof candidate.lane !== 'string') {
      throw new Error(
        `topic review result.laneResults[${index}].lane must be a known lane`,
      );
    }
    return candidate.lane as ReviewLane;
  });
  if (
    actualLanes.length !== expectedLanes.length ||
    new Set(actualLanes).size !== actualLanes.length ||
    expectedLanes.some((lane) => !actualLanes.includes(lane))
  ) {
    throw new Error(
      `topic review result must contain exactly these lanes: ${expectedLanes.join(', ')}`,
    );
  }
  return {
    version: 1,
    topicId: expectedTopic,
    laneResults: value.laneResults.map((item) => {
      const lane = (item as { lane: ReviewLane }).lane;
      return parseLaneResult(JSON.stringify(item), expectedTopic, lane);
    }),
  };
}

export function parseTopicVerdict(
  summary: string,
  expectedTopic: string,
): TopicVerdict {
  const value = parseStrictJsonObject(summary, 'topic verdict output');
  assertExactKeys(
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
  const coveredLanes = nonEmptyStringArray(
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
    coveredFiles: nonEmptyStringArray(
      value.coveredFiles,
      'topic verdict.coveredFiles',
    ),
    coveredLanes: coveredLanes as ReviewLane[],
    summary: requiredNonEmptyString(value, 'summary', 'topic verdict'),
  };
}

export function parseGlobalVerdict(summary: string): GlobalVerdict {
  const value = parseStrictJsonObject(summary, 'global verdict output');
  assertExactKeys(
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
    summary: requiredNonEmptyString(value, 'summary', 'global verdict'),
    coverageComplete: value.coverageComplete,
  };
}
