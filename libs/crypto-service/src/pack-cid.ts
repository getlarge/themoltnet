/**
 * Pack CID — DAG-CBOR content-addressable identifiers for context packs
 *
 * Produces CIDv1 identifiers (sha2-256, dag-cbor codec, base32lower) for
 * compiled context packs. The DAG-CBOR envelope commits to the exact set of
 * entry CIDs, compilation parameters, and provenance metadata.
 *
 * Unlike entry CIDs (raw codec, opaque leaf nodes), pack CIDs use dag-cbor
 * codec which encodes IPLD links — making each entry CID a traversable
 * reference in the Merkle DAG.
 *
 * Envelope schema (v1):
 * {
 *   v: 'moltnet:pack:v1',
 *   diaryId: string,
 *   createdBy: string,
 *   createdAt: string (ISO 8601),
 *   packType: 'compile' | 'optimized',
 *   params: { ... type-specific parameters },
 *   entries: [{ cid: CID, compressionLevel: string, rank: number }]
 * }
 */

import * as dagCbor from '@ipld/dag-cbor';
import { sha256 } from '@noble/hashes/sha2';
import { base32 } from 'multiformats/bases/base32';
import { CID } from 'multiformats/cid';
import { create } from 'multiformats/hashes/digest';

/** SHA-256 multicodec code per multihash table */
const SHA2_256_CODE = 0x12;

/** DAG-CBOR multicodec code */
const DAG_CBOR_CODE = 0x71;

export type PackType = 'compile' | 'optimized';

export type CompressionLevel = 'full' | 'summary' | 'keywords';

/** Compile-specific parameters stored in the envelope. */
export interface CompileParams {
  tokenBudget: number;
  lambda?: number;
  taskPromptHash?: string;
  wRecency?: number;
  wImportance?: number;
}

/** GEPA optimization parameters stored in the envelope. */
export interface OptimizedParams {
  sourcePackCid: string;
  gepaTrials: number;
  gepaScore: number;
  teacherModel?: string;
  studentModel?: string;
}

/** An entry reference in the pack envelope. */
export interface PackEntryRef {
  /** CIDv1 string of the entry's contentHash at pack time. */
  cid: string;
  compressionLevel: CompressionLevel;
  rank: number;
}

/** Input to computePackCid — everything needed to build the envelope. */
export interface PackEnvelopeInput {
  diaryId: string;
  createdBy: string;
  createdAt: string;
  packType: PackType;
  params: CompileParams | OptimizedParams;
  entries: PackEntryRef[];
}

/**
 * Build the canonical DAG-CBOR envelope for a context pack.
 *
 * Entry CIDs are parsed and embedded as IPLD CID links, making the pack
 * a proper Merkle DAG node that references its source entries.
 *
 * The envelope is deterministic: same input always produces the same bytes.
 * DAG-CBOR encodes maps with sorted keys (per DAG-CBOR spec), so field
 * order in the input object does not affect the output.
 */
export function buildPackEnvelope(input: PackEnvelopeInput): Uint8Array {
  const entries = input.entries.map((entry) => ({
    cid: CID.parse(entry.cid),
    compressionLevel: entry.compressionLevel,
    rank: entry.rank,
  }));

  // Sort entries by rank for determinism (rank is unique per pack).
  entries.sort((a, b) => a.rank - b.rank);

  const envelope = {
    v: 'moltnet:pack:v1',
    createdAt: input.createdAt,
    createdBy: input.createdBy,
    diaryId: input.diaryId,
    entries,
    packType: input.packType,
    params: input.params,
  };

  return dagCbor.encode(envelope);
}

/**
 * Compute a CIDv1 for a context pack from its envelope input.
 *
 * Format: CIDv1 with sha2-256 hash, dag-cbor codec, base32lower multibase.
 * Example output: "bafyreig..."
 *
 * The CID commits to all entry CIDs, compilation parameters, and provenance.
 * If any entry content changes (different entry CID), the pack CID changes.
 */
export function computePackCid(input: PackEnvelopeInput): string {
  const bytes = buildPackEnvelope(input);
  const hash = sha256(bytes);
  const digest = create(SHA2_256_CODE, hash);
  const cid = CID.createV1(DAG_CBOR_CODE, digest);
  return cid.toString(base32);
}

/**
 * Decode a DAG-CBOR pack envelope back to its structured form.
 *
 * Useful for inspecting persisted pack payloads and verifying CID integrity.
 */
export function decodePackEnvelope(bytes: Uint8Array): unknown {
  return dagCbor.decode(bytes);
}
