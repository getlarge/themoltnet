/**
 * Rendered Pack CID — DAG-CBOR content-addressable identifiers for rendered packs
 *
 * Produces CIDv1 identifiers (sha2-256, dag-cbor codec, base32lower) for
 * rendered packs. The envelope commits to the source pack CID (as an IPLD
 * link), the render method, and a SHA-256 hash of the rendered content.
 *
 * Separate from pack-cid.ts because rendered packs have a fundamentally
 * different envelope: no entry refs, no diaryId, no packType discriminator.
 *
 * Envelope schema (v1):
 * {
 *   v: 'moltnet:rendered-pack:v1',
 *   sourcePackCid: CID (IPLD link),
 *   renderMethod: string,
 *   contentHash: string,
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

export interface RenderedPackEnvelopeInput {
  /** CIDv1 string of the source context pack. */
  sourcePackCid: string;
  /** Render method label, e.g. 'pack-to-docs-v1'. */
  renderMethod: string;
  /** SHA-256 hex digest of the rendered markdown content. */
  contentHash: string;
}

/**
 * Build the canonical DAG-CBOR envelope for a rendered pack.
 *
 * The source pack CID is parsed and embedded as an IPLD CID link,
 * making the rendered pack a Merkle DAG node that references its source.
 *
 * The envelope is deterministic: same input always produces the same bytes.
 */
export function buildRenderedPackEnvelope(
  input: RenderedPackEnvelopeInput,
): Uint8Array {
  const envelope = {
    contentHash: input.contentHash,
    renderMethod: input.renderMethod,
    sourcePackCid: CID.parse(input.sourcePackCid),
    v: 'moltnet:rendered-pack:v1',
  };

  return dagCbor.encode(envelope);
}

/**
 * Compute a CIDv1 for a rendered pack from its envelope input.
 *
 * Format: CIDv1 with sha2-256 hash, dag-cbor codec, base32lower multibase.
 */
export function computeRenderedPackCid(
  input: RenderedPackEnvelopeInput,
): string {
  const bytes = buildRenderedPackEnvelope(input);
  const hash = sha256(bytes);
  const digest = create(SHA2_256_CODE, hash);
  const cid = CID.createV1(DAG_CBOR_CODE, digest);
  return cid.toString(base32);
}

/**
 * Compute the SHA-256 hex digest of rendered markdown content.
 * Used as the contentHash in the rendered pack envelope.
 */
export function computeContentHash(content: string): string {
  const bytes = new TextEncoder().encode(content);
  const hash = sha256(bytes);
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
