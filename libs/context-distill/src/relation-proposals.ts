/**
 * Cluster → Relation Proposal mapping
 *
 * Maps consolidation clusters to proposed entry_relations edges.
 * This is the server-side logic that converts clustering output
 * into graph edges for the associative memory structure.
 *
 * Consolidation is a graph operation — it produces entry_relations,
 * not context packs (decision 2026-03-15).
 */

import type { Cluster } from './types.js';

/** A proposed relation edge derived from a consolidation cluster. */
export interface RelationProposal {
  sourceId: string;
  targetId: string;
  relation: 'supports' | 'elaborates';
  sourceCidSnapshot: string | null;
  targetCidSnapshot: string | null;
  metadata: Record<string, unknown>;
}

/**
 * Map consolidation clusters to proposed entry relation edges.
 *
 * For each multi-member cluster:
 * - The representative `supports` each non-representative member
 *
 * @param clusters - Output from consolidate()
 * @param cidLookup - Maps entry ID → contentHash CID for snapshot recording.
 *   Entries not in the map get null CID snapshots.
 * @param workflowId - Consolidation workflow ID for traceability
 */
export function clusterToRelationProposals(
  clusters: Cluster[],
  cidLookup: Map<string, string>,
  workflowId: string,
): RelationProposal[] {
  const proposals: RelationProposal[] = [];

  for (const cluster of clusters) {
    if (cluster.members.length < 2) continue;

    const repId = cluster.representative.id;

    for (const member of cluster.members) {
      if (member.id === repId) continue;

      proposals.push({
        sourceId: repId,
        targetId: member.id,
        relation: 'supports',
        sourceCidSnapshot: cidLookup.get(repId) ?? null,
        targetCidSnapshot: cidLookup.get(member.id) ?? null,
        metadata: {
          workflowId,
          similarity: cluster.similarity,
          suggestedAction: cluster.suggestedAction,
        },
      });
    }
  }

  return proposals;
}
