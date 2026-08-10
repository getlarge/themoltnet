import {
  CopyButton,
  DescriptionList,
  type DescriptionListItem,
  type SignatureState,
  SignatureStatus,
  Stack,
  Text,
} from '@themoltnet/design-system';
import type { ReactNode } from 'react';

import type { DiaryEntry, EntryVerifyResult } from '../types.js';
import { formatDateTime } from '../utils/format.js';
import { TagChip } from './TagChip.js';

/**
 * The principal that created an entry. Derived from the wire type so the two
 * can never drift: the API exposes `created_by` as this resolved `creator`
 * object rather than a bare identity id.
 */
export type EntryCreator = DiaryEntry['creator'];

/** The subset of a diary entry that carries attribution evidence. */
export interface AttributionEntry {
  contentHash: string | null;
  contentSignature: string | null;
  createdAt: string;
  creator: EntryCreator;
  tags: string[] | null;
}

export interface AttributionPanelProps {
  entry: AttributionEntry;
  /**
   * Result of `POST /entries/:id/verify`, or `null` when verification has not
   * been fetched. `null` is not evidence of anything — see
   * {@link deriveSignatureState}.
   */
  verification: EntryVerifyResult | null;
  onTagClick?: (tag: string) => void;
}

/**
 * Tag prefixes used by the accountable-commit and task conventions. Grounded in
 * the live tag vocabulary, not invented: `scope:`, `branch:`, `task:`, `issue:`
 * and `pr:` are the five most common prefixes in the diary.
 *
 * **These are a naming convention, not authenticated provenance.** `tags` is a
 * plain `text[]` (`apps/rest-api/src/schemas/diary.ts`) with no server-side
 * check that a `branch:` tag names a real branch or that `accountable-commit`
 * accompanied a commit. Any writer can set them by hand, so the UI groups them
 * for legibility and says nothing about where they came from.
 */
export const STRUCTURED_TAG_PREFIXES = [
  'branch:',
  'commit:',
  'issue:',
  'pr:',
  'risk:',
  'scope:',
  'task:',
  'task-family:',
  'task-group:',
  'task-summary:',
] as const;

/** Convention markers that carry no `prefix:`. Same caveat as the prefixes. */
export const STRUCTURED_TAG_LITERALS = ['accountable-commit'] as const;

export interface PartitionedTags {
  structured: string[];
  free: string[];
}

/**
 * Split convention-prefixed tags from free tags, preserving the author's
 * ordering within each group. Purely a legibility aid — see
 * {@link STRUCTURED_TAG_PREFIXES} for why this is not a provenance claim.
 */
export function partitionStructuredTags(
  tags: string[] | null | undefined,
): PartitionedTags {
  const structured: string[] = [];
  const free: string[] = [];

  for (const tag of tags ?? []) {
    const isStructured =
      STRUCTURED_TAG_PREFIXES.some((prefix) => tag.startsWith(prefix)) ||
      (STRUCTURED_TAG_LITERALS as readonly string[]).includes(tag);
    (isStructured ? structured : free).push(tag);
  }

  return { structured, free };
}

/**
 * How much weight the signer fingerprint carries.
 *
 * - `confirmed`   — the signature verified against this agent's public key.
 * - `unconfirmed` — a fingerprint is known but the signature did not verify,
 *   so it is a claim, not an attribution.
 * - `unknown`     — the entry is signed but no signer could be established,
 *   either because verification has not run or because the server could not
 *   resolve the signing request. **Never "not signed".**
 * - `none`        — the entry carries no signature at all.
 */
export type SignerConfidence = 'confirmed' | 'unconfirmed' | 'unknown' | 'none';

export interface SignerAttribution {
  fingerprint: string | null;
  confidence: SignerConfidence;
  label: string;
}

export interface DerivedSignatureState {
  state: SignatureState;
  /** Overrides the primitive's default label when the default would mislead. */
  label?: string;
  explanation: string;
  /**
   * Who the signature is attributed to, derived from the *whole* verification
   * state. Reading `agentFingerprint` alone would render "Not signed" for a
   * signed entry whose signing request the server could not resolve.
   */
  signer: SignerAttribution;
}

const NO_SIGNER: SignerAttribution = {
  fingerprint: null,
  confidence: 'none',
  label: 'Not signed',
};

/**
 * Map an entry plus its verification result onto an honest signature state.
 *
 * The one rule that matters: **`signed` is checked first.** The API returns
 * `{signed: false, hashMatches: false, signatureValid: false, valid: false}`
 * for an entry that was never signed, so reading `valid` on its own would
 * report a perfectly ordinary unsigned entry as a failure. Signing is opt-in
 * in MoltNet (diary entry `beece2e2` — "signing opt-in is the only
 * immutability gate"), and `semantic` / `episodic` entries are frequently and
 * legitimately unsigned.
 */
export function deriveSignatureState({
  contentSignature,
  verification,
}: {
  contentSignature: string | null;
  verification: EntryVerifyResult | null;
}): DerivedSignatureState {
  const hasSignature =
    typeof contentSignature === 'string' && contentSignature.trim() !== '';

  // Unsigned wins over everything. Never a failure state.
  if (verification ? !verification.signed : !hasSignature) {
    return {
      state: 'unsigned',
      explanation:
        'This entry is unsigned. Signing is opt-in in MoltNet, and semantic and episodic entries are frequently left unsigned. The content hash below still fingerprints the bytes; nothing locks them.',
      signer: NO_SIGNER,
    };
  }

  if (!verification) {
    return {
      state: 'unverified',
      explanation:
        'A signature is present but has not been checked in this session.',
      signer: {
        fingerprint: null,
        confidence: 'unknown',
        label: 'Signature not checked',
      },
    };
  }

  if (verification.valid) {
    return {
      state: 'verified',
      explanation:
        'The entry bytes still hash to the signed content hash, and that hash carries a valid signature from the signing agent.',
      signer: verification.agentFingerprint
        ? {
            fingerprint: verification.agentFingerprint,
            confidence: 'confirmed',
            label: verification.agentFingerprint,
          }
        : unresolvedSigner(),
    };
  }

  // Signed but not valid. A fingerprint here is a claim the check did not
  // confirm, so it must never be presented as settled attribution.
  const signer: SignerAttribution = verification.agentFingerprint
    ? {
        fingerprint: verification.agentFingerprint,
        confidence: 'unconfirmed',
        label: `${verification.agentFingerprint} · unconfirmed`,
      }
    : unresolvedSigner();

  if (!verification.hashMatches) {
    return {
      state: 'invalid',
      label: 'Content changed',
      explanation:
        'Content changed since signing — the entry no longer hashes to the content hash that was signed.',
      signer,
    };
  }

  return {
    state: 'invalid',
    label: 'Signature not verified',
    explanation:
      "Signature did not verify against the signing agent's public key. The bytes still match the recorded content hash.",
    signer,
  };
}

/** Signed, but the server could not establish who signed it. */
function unresolvedSigner(): SignerAttribution {
  return {
    fingerprint: null,
    confidence: 'unknown',
    label: 'Signer could not be resolved',
  };
}

/**
 * Attribution evidence for a diary entry: who wrote it, whether the bytes are
 * signed, and the hash the signature covers.
 *
 * Deliberately shared (`@moltnet/diary-ui`, not the console) so the diary map
 * and any other entry surface show the same evidence with the same wording.
 */
export function AttributionPanel({
  entry,
  verification,
  onTagClick,
}: AttributionPanelProps) {
  const signature = deriveSignatureState({
    contentSignature: entry.contentSignature,
    verification,
  });
  const { structured, free } = partitionStructuredTags(entry.tags);

  const items: DescriptionListItem[] = [
    {
      label: 'Created by',
      value: <CreatorValue creator={entry.creator} />,
    },
    {
      label: 'Created',
      value: formatDateTime(entry.createdAt),
    },
    {
      label: 'Signed by',
      value:
        signature.signer.confidence === 'confirmed' ? (
          <Text mono color="accent">
            {signature.signer.label}
          </Text>
        ) : (
          <Text
            mono={signature.signer.fingerprint !== null}
            color={signature.signer.fingerprint ? 'warning' : 'muted'}
          >
            {signature.signer.label}
          </Text>
        ),
    },
    {
      label: 'Content hash (CID)',
      // `CopyButton` renders the value itself in mono — it is the primitive for
      // "copyable evidence string", so the hash is not also printed beside it.
      value: entry.contentHash ? (
        <CopyButton
          value={entry.contentHash}
          size="sm"
          ariaLabel="Copy content hash"
        />
      ) : (
        <Text color="muted">Not computed</Text>
      ),
    },
  ];

  return (
    <Stack gap={4}>
      <Stack direction="row" gap={3} align="center" wrap>
        <Text variant="h4">Attribution</Text>
        <SignatureStatus state={signature.state} label={signature.label} />
      </Stack>

      <Text color="secondary">{signature.explanation}</Text>

      <DescriptionList
        items={items}
        columns={2}
        ariaLabel="Entry attribution"
      />

      {structured.length > 0 && (
        <TagGroup
          label="Structured tags"
          description="Follow the prefix:value convention used by the commit and task flows. Tags are author-supplied and are not verified by the server."
          tags={structured}
          onTagClick={onTagClick}
        />
      )}

      {free.length > 0 && (
        <TagGroup label="Tags" tags={free} onTagClick={onTagClick} />
      )}

      <Stack gap={1}>
        <Text variant="caption" color="muted">
          The signature covers the content hash, not the author field.
          Verification recomputes the hash from the entry bytes and checks that
          hash against the signature.
        </Text>
        <Text variant="caption" color="muted">
          Attribution is separate from access. Granting read access to a diary
          does not change who wrote an entry.
        </Text>
      </Stack>
    </Stack>
  );
}

function CreatorValue({ creator }: { creator: EntryCreator }) {
  if (creator.kind === 'agent') {
    return (
      <Stack gap={1}>
        <Text variant="caption" color="muted">
          Agent
        </Text>
        <Text mono color="accent">
          {creator.fingerprint}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap={1}>
      <Text variant="caption" color="muted">
        Human
      </Text>
      <Text mono color="accent" style={{ overflowWrap: 'anywhere' }}>
        {creator.humanId}
      </Text>
    </Stack>
  );
}

function TagGroup({
  label,
  description,
  tags,
  onTagClick,
}: {
  label: string;
  description?: ReactNode;
  tags: string[];
  onTagClick?: (tag: string) => void;
}) {
  return (
    <div role="group" aria-label={label}>
      <Stack gap={2}>
        <Text variant="overline" color="muted">
          {label}
        </Text>
        {description && (
          <Text variant="caption" color="muted">
            {description}
          </Text>
        )}
        <Stack direction="row" gap={2} wrap style={{ minWidth: 0 }}>
          {tags.map((tag) => (
            <TagChip key={tag} tag={tag} onClick={onTagClick} />
          ))}
        </Stack>
      </Stack>
    </div>
  );
}
