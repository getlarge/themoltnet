import {
  assertExactKeys,
  boundedArray,
  nonEmptyStringArray,
  parseStrictJsonObject,
  requiredNonEmptyString,
  strictRecord,
} from './strict-json.js';
import {
  DOSSIER_ARTIFACT_KIND,
  MAX_CLAIMS_PER_DOSSIER,
  type StagedArtifact,
  type TrackCandidate,
  type TrackDossier,
  WIREFRAME_ARTIFACT_KIND,
} from './types.js';

const DOSSIER_FIELDS = [
  'version',
  'trackId',
  'slug',
  'workingTitle',
  'description',
  'tags',
  'claims',
  'openQuestions',
] as const;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_TAGS = 8;
const MAX_OPEN_QUESTIONS = 10;

/** An artifact entry as reported by the agent in `submit_freeform_output`. */
interface ReportedArtifact {
  kind: string;
  title: string;
  cid?: string;
  contentType?: string;
  sizeBytes?: number;
}

function requireUploadedArtifact(
  artifacts: ReportedArtifact[],
  kind: string,
  label: string,
): StagedArtifact {
  const matches = artifacts.filter((artifact) => artifact.kind === kind);
  if (matches.length !== 1) {
    throw new Error(
      `${label} must report exactly one ${kind} artifact, got ${matches.length}`,
    );
  }
  const [artifact] = matches;
  if (!artifact.cid) {
    throw new Error(
      `${label} ${kind} artifact must carry the CID returned by moltnet_upload_task_artifact`,
    );
  }
  if (typeof artifact.sizeBytes !== 'number' || artifact.sizeBytes <= 0) {
    throw new Error(
      `${label} ${kind} artifact must report a positive sizeBytes`,
    );
  }
  return {
    cid: artifact.cid,
    title: artifact.title,
    contentType: artifact.contentType ?? 'text/markdown;charset=utf-8',
    sizeBytes: artifact.sizeBytes,
  };
}

/**
 * Parse a draft agent's output for one track.
 *
 * Two things are checked that prompt text cannot enforce on its own:
 *
 * 1. **Citation containment.** Every claim cites a signal id, and that id must
 *    belong to *this* track. A draft cannot reach for a source that correlation
 *    assigned to a different piece, and it certainly cannot invent one.
 * 2. **Artifact presence.** The dossier and wireframe must exist as uploaded
 *    task artifacts with real CIDs. Prose pasted into the summary does not
 *    count — the artifact is the deliverable, and it has to be fetchable later.
 */
export function parseTrackDossier(
  source: string,
  track: TrackCandidate,
  artifacts: ReportedArtifact[],
): TrackDossier {
  const label = `dossier (${track.id})`;
  const record = parseStrictJsonObject(source, label);
  assertExactKeys(record, DOSSIER_FIELDS, label);
  if (record.version !== 1) {
    throw new Error(`${label}.version must be 1`);
  }
  if (record.trackId !== track.id) {
    throw new Error(
      `${label}.trackId must be ${track.id}, got ${String(record.trackId)}`,
    );
  }
  const slug = requiredNonEmptyString(record, 'slug', label, 80);
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`${label}.slug must be a kebab-case slug`);
  }

  const citable = new Set([...track.workSignalIds, ...track.marketSignalIds]);
  const claimItems = boundedArray(
    record.claims,
    `${label}.claims`,
    MAX_CLAIMS_PER_DOSSIER,
  );
  if (claimItems.length === 0) {
    throw new Error(`${label}.claims must contain at least one claim`);
  }
  const claims = claimItems.map((item, index) => {
    const itemLabel = `${label}.claims[${index}]`;
    const value = strictRecord(item, itemLabel);
    assertExactKeys(value, ['signalId', 'claim'], itemLabel);
    const signalId = requiredNonEmptyString(value, 'signalId', itemLabel, 60);
    if (!citable.has(signalId)) {
      throw new Error(
        `${itemLabel} cites ${signalId}, which is not a source assigned to track ${track.id}`,
      );
    }
    return {
      signalId,
      claim: requiredNonEmptyString(value, 'claim', itemLabel, 1000),
    };
  });

  const cited = new Set(claims.map((claim) => claim.signalId));
  const uncited = [...citable].filter((signalId) => !cited.has(signalId));
  if (uncited.length === citable.size) {
    throw new Error(`${label} cites none of the track's assigned signals`);
  }

  return {
    version: 1,
    trackId: track.id,
    slug,
    workingTitle: requiredNonEmptyString(record, 'workingTitle', label, 200),
    description: requiredNonEmptyString(record, 'description', label, 500),
    tags: nonEmptyStringArray(record.tags, `${label}.tags`, MAX_TAGS),
    claims,
    openQuestions: nonEmptyStringArray(
      record.openQuestions,
      `${label}.openQuestions`,
      MAX_OPEN_QUESTIONS,
    ),
    dossierArtifact: requireUploadedArtifact(
      artifacts,
      DOSSIER_ARTIFACT_KIND,
      label,
    ),
    wireframeArtifact: requireUploadedArtifact(
      artifacts,
      WIREFRAME_ARTIFACT_KIND,
      label,
    ),
  };
}

/** Signals the plan assigned to a track that its dossier never used. */
export function unusedSignals(
  track: TrackCandidate,
  dossier: TrackDossier,
): string[] {
  const cited = new Set(dossier.claims.map((claim) => claim.signalId));
  return [...track.workSignalIds, ...track.marketSignalIds].filter(
    (signalId) => !cited.has(signalId),
  );
}
