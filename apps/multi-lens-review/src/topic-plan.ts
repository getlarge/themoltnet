import {
  type CoverageLedger,
  MANDATORY_REVIEW_LANES,
  type ModelFileExclusion,
  REVIEW_LANES,
  type ReviewLane,
  type ReviewManifest,
  type ReviewTopic,
  type TopicPlan,
} from './types.js';

export const MAX_TOPICS = 12;
export const MAX_PRIMARY_FILES_PER_TOPIC = 12;
export const MAX_CONTEXT_FILES_PER_TOPIC = 6;
export const MAX_CONTEXT_OWNERS_PER_FILE = 2;
export const MAX_TOPIC_BYTES = 64 * 1024;
export const MAX_SINGLETON_TOPIC_BYTES = 128 * 1024;
export const MAX_SPECIALIST_TASKS = 32;

const KNOWN_LANES = new Set<string>(REVIEW_LANES);
const TOPIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${label} contains unknown fields: ${unknown.join(', ')}`);
  }
}

function stringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || !item.trim())
  ) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  return value.map((item) => (item as string).trim());
}

/** Parse the planner's summary as strict JSON before trusted validation. */
export function parseTopicPlanJson(summary: string): TopicPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(summary);
  } catch {
    throw new Error('planner output must be strict JSON');
  }
  const root = asRecord(parsed, 'topic plan');
  exactKeys(root, ['version', 'excludedFiles', 'topics'], 'topic plan');
  if (
    root.version !== 1 ||
    !Array.isArray(root.excludedFiles) ||
    !Array.isArray(root.topics)
  ) {
    throw new Error(
      'topic plan requires version 1, excludedFiles, and topics arrays',
    );
  }
  const excludedFiles = root.excludedFiles.map(
    (value, index): ModelFileExclusion => {
      const exclusion = asRecord(value, `excludedFiles[${index}]`);
      exactKeys(
        exclusion,
        ['path', 'reason', 'evidence'],
        `excludedFiles[${index}]`,
      );
      for (const key of ['path', 'reason', 'evidence'] as const) {
        if (typeof exclusion[key] !== 'string' || !exclusion[key].trim()) {
          throw new Error(
            `excludedFiles[${index}].${key} must be a non-empty string`,
          );
        }
      }
      return {
        path: (exclusion.path as string).trim(),
        reason: (exclusion.reason as string).trim(),
        evidence: (exclusion.evidence as string).trim(),
      };
    },
  );
  const topics = root.topics.map((value, index): ReviewTopic => {
    const topic = asRecord(value, `topics[${index}]`);
    exactKeys(
      topic,
      ['id', 'title', 'primaryFiles', 'contextFiles', 'lanes'],
      `topics[${index}]`,
    );
    if (typeof topic.id !== 'string' || typeof topic.title !== 'string') {
      throw new Error(`topics[${index}] requires string id and title`);
    }
    const primaryFiles = stringArray(
      topic.primaryFiles,
      `topics[${index}].primaryFiles`,
    );
    const contextFiles =
      topic.contextFiles === undefined
        ? undefined
        : stringArray(topic.contextFiles, `topics[${index}].contextFiles`);
    const lanes = stringArray(topic.lanes, `topics[${index}].lanes`);
    return {
      id: topic.id,
      title: topic.title,
      primaryFiles,
      ...(contextFiles ? { contextFiles } : {}),
      lanes: lanes as ReviewLane[],
    };
  });
  return { version: 1, excludedFiles, topics };
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function laneUnion(
  topic: ReviewTopic,
  manifest: ReviewManifest,
  requestedLanes: readonly ReviewLane[],
): ReviewLane[] {
  const files = new Map(manifest.files.map((file) => [file.path, file]));
  const lanes = new Set<ReviewLane>([
    ...MANDATORY_REVIEW_LANES,
    ...requestedLanes,
  ]);
  for (const path of topic.primaryFiles) {
    for (const lane of files.get(path)?.requiredLanes ?? []) lanes.add(lane);
  }
  for (const lane of topic.lanes) lanes.add(lane);
  return REVIEW_LANES.filter((lane) => lanes.has(lane));
}

export function validateTopicPlan(
  plan: TopicPlan,
  manifest: ReviewManifest,
  requestedLanes: readonly ReviewLane[] = [],
): TopicPlan {
  const diagnostics: string[] = [];
  const reviewable = new Map(
    manifest.files
      .filter((file) => file.reviewable)
      .map((file) => [file.path, file]),
  );
  if (plan.version !== 1) diagnostics.push('plan version must be 1');
  if (plan.topics.length === 0) diagnostics.push('plan must contain a topic');
  if (plan.topics.length > MAX_TOPICS) {
    diagnostics.push(
      `plan has ${plan.topics.length} topics; maximum is ${MAX_TOPICS}`,
    );
  }
  const ids = plan.topics.map((topic) => topic.id);
  if (!unique(ids)) diagnostics.push('topic ids must be unique');
  const owners = new Map<string, string[]>();
  const contextOwners = new Map<string, string[]>();
  const normalizedTopics = plan.topics.map((topic, index): ReviewTopic => {
    if (!TOPIC_ID.test(topic.id)) {
      diagnostics.push(
        `topics[${index}].id must be a lowercase kebab-case identifier`,
      );
    }
    if (!topic.title.trim())
      diagnostics.push(`topics[${index}].title is empty`);
    if (!unique(topic.primaryFiles)) {
      diagnostics.push(`topic ${topic.id} repeats a primary file`);
    }
    if ((topic.contextFiles?.length ?? 0) > MAX_CONTEXT_FILES_PER_TOPIC) {
      diagnostics.push(
        `topic ${topic.id} has too many context files (maximum ${MAX_CONTEXT_FILES_PER_TOPIC})`,
      );
    }
    if (!unique(topic.contextFiles ?? [])) {
      diagnostics.push(`topic ${topic.id} repeats a context file`);
    }
    if (topic.primaryFiles.length === 0) {
      diagnostics.push(`topic ${topic.id} has no primary files`);
    }
    if (topic.primaryFiles.length > MAX_PRIMARY_FILES_PER_TOPIC) {
      diagnostics.push(
        `topic ${topic.id} has ${topic.primaryFiles.length} primary files; maximum is ${MAX_PRIMARY_FILES_PER_TOPIC}`,
      );
    }
    for (const path of topic.primaryFiles) {
      if (!reviewable.has(path)) {
        diagnostics.push(`topic ${topic.id} has unknown primary file ${path}`);
      }
      owners.set(path, [...(owners.get(path) ?? []), topic.id]);
    }
    for (const path of topic.contextFiles ?? []) {
      if (!reviewable.has(path)) {
        diagnostics.push(`topic ${topic.id} has unknown context file ${path}`);
      }
      if (topic.primaryFiles.includes(path)) {
        diagnostics.push(
          `topic ${topic.id} uses ${path} as both primary and context`,
        );
      }
      contextOwners.set(path, [...(contextOwners.get(path) ?? []), topic.id]);
    }
    const unknownLanes = topic.lanes.filter((lane) => !KNOWN_LANES.has(lane));
    if (unknownLanes.length > 0) {
      diagnostics.push(
        `topic ${topic.id} requests unknown lanes: ${unknownLanes.join(', ')}`,
      );
    }
    const lanes = laneUnion(topic, manifest, requestedLanes);
    const paths = [...topic.primaryFiles, ...(topic.contextFiles ?? [])];
    const bytes = paths.reduce(
      (total, path) => total + (reviewable.get(path)?.byteSize ?? 0),
      0,
    );
    const byteLimit =
      topic.primaryFiles.length === 1 && (topic.contextFiles?.length ?? 0) === 0
        ? MAX_SINGLETON_TOPIC_BYTES
        : MAX_TOPIC_BYTES;
    if (bytes > byteLimit) {
      diagnostics.push(
        `topic ${topic.id} is ${bytes} bytes; maximum is ${byteLimit}`,
      );
    }
    return { ...topic, lanes };
  });
  for (const path of reviewable.keys()) {
    const primaryOwners = owners.get(path) ?? [];
    if (primaryOwners.length === 0) {
      diagnostics.push(`reviewable file ${path} has no primary owner`);
    } else if (primaryOwners.length > 1) {
      diagnostics.push(
        `reviewable file ${path} has duplicate primary ownership: ${primaryOwners.join(', ')}`,
      );
    }
  }
  for (const [path, topicIds] of contextOwners) {
    if (topicIds.length > MAX_CONTEXT_OWNERS_PER_FILE) {
      diagnostics.push(
        `context file ${path} overlaps ${topicIds.length} topics; maximum is ${MAX_CONTEXT_OWNERS_PER_FILE}`,
      );
    }
  }
  const specialistTasks = normalizedTopics.reduce(
    (total, topic) => total + topic.lanes.length,
    0,
  );
  if (specialistTasks > MAX_SPECIALIST_TASKS) {
    diagnostics.push(
      `plan requires ${specialistTasks} specialist tasks; maximum is ${MAX_SPECIALIST_TASKS}`,
    );
  }
  if (diagnostics.length > 0) {
    throw new Error(`invalid topic plan:\n- ${diagnostics.join('\n- ')}`);
  }
  return {
    version: 1,
    excludedFiles: plan.excludedFiles,
    topics: normalizedTopics,
  };
}

/**
 * Small changes bypass an agent planner. The thresholds guarantee bounded
 * bytes; trusted deterministic plans are allowed up to 25 primary files even
 * though untrusted planner topics are capped at 12.
 */
export function deterministicTopicPlan(
  manifest: ReviewManifest,
  requestedLanes: readonly ReviewLane[] = [],
): TopicPlan {
  const primaryFiles = manifest.files
    .filter((file) => file.reviewable)
    .map((file) => file.path);
  const topic: ReviewTopic = {
    id: 'change',
    title: 'Change under review',
    primaryFiles,
    lanes: [],
  };
  const lanes = laneUnion(topic, manifest, requestedLanes);
  return { version: 1, excludedFiles: [], topics: [{ ...topic, lanes }] };
}

export function removeExcludedFilesFromPlan(
  plan: TopicPlan,
  manifest: ReviewManifest,
): TopicPlan {
  const reviewable = new Set(
    manifest.files.filter((file) => file.reviewable).map((file) => file.path),
  );
  return {
    ...plan,
    topics: plan.topics
      .map((topic) => ({
        ...topic,
        primaryFiles: topic.primaryFiles.filter((path) => reviewable.has(path)),
        ...(topic.contextFiles
          ? {
              contextFiles: topic.contextFiles.filter((path) =>
                reviewable.has(path),
              ),
            }
          : {}),
      }))
      .filter((topic) => topic.primaryFiles.length > 0),
  };
}

export function coverageLedgerForPlan(
  manifest: ReviewManifest,
  plan: TopicPlan,
): CoverageLedger {
  const primaryOwners: Record<string, string | null> = Object.fromEntries(
    manifest.coverage.reviewableFiles.map((path) => [path, null]),
  );
  const laneCoverage: Record<string, ReviewLane[]> = Object.fromEntries(
    manifest.coverage.reviewableFiles.map((path) => [path, []]),
  );
  for (const topic of plan.topics) {
    for (const path of topic.primaryFiles) {
      primaryOwners[path] = topic.id;
      laneCoverage[path] = [...topic.lanes];
    }
  }
  const complete = Object.values(primaryOwners).every(
    (owner) => owner !== null,
  );
  return {
    ...manifest.coverage,
    primaryOwners,
    laneCoverage,
    complete,
  };
}

export function topicByteSize(
  manifest: ReviewManifest,
  topic: ReviewTopic,
): number {
  const files = new Map(manifest.files.map((file) => [file.path, file]));
  return [...topic.primaryFiles, ...(topic.contextFiles ?? [])].reduce(
    (total, path) => total + (files.get(path)?.byteSize ?? 0),
    0,
  );
}
