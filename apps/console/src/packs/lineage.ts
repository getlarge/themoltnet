/**
 * Reduces a provenance graph to its **lineage spine**.
 *
 * `buildPackProvenanceGraph` (`apps/rest-api/src/routes/pack-provenance.ts`)
 * BFS-walks the supersession chain and, for *each* pack in that chain, emits
 * every member entry as a node. A depth-3 chain of packs holding 20 entries
 * each is ~80 entry nodes around a 4-node spine. Two different things share one
 * payload:
 *
 * - the **spine** — packs joined by `supersedes`, plus their rendered outputs.
 *   Few nodes, high meaning per node. This is lineage.
 * - the **membership** — the entries a pack selected. Many nodes, low meaning
 *   individually. That is `PackComposition`'s job, not lineage's.
 *
 * Dropping entry nodes here is what lets the lineage surface render without
 * pan-zoom, collapse/expand, or a fit-to-viewport control: the thing that made
 * those necessary is gone.
 *
 * Edge directions are verified against the builder, not assumed:
 * - `supersedes`   newer pack -> older pack
 * - `includes`     pack -> entry
 * - `rendered_from` **source pack -> rendered pack**
 */
import type {
  ProvenanceGraph,
  ProvenanceGraphCreator,
  ProvenanceGraphNode,
} from '@moltnet/models';

export interface SpineNode {
  /** Graph node id, e.g. `pack:<uuid>` or `rendered_pack:<uuid>`. */
  id: string;
  kind: 'pack' | 'rendered_pack';
  label: string;
  cid: string | null;
  pinned: boolean;
  expiresAt: string | null;
  createdAt: string;
  /** True for the pack the operator is currently looking at. */
  isRoot: boolean;
  /** How many entries this node includes. Zero for rendered packs. */
  entryCount: number;
  creator: ProvenanceGraphCreator | null;
  /** Set for context packs only — drives the pin control. */
  packId?: string;
  /** Set for rendered packs only. These render read-only for now. */
  renderedPackId?: string;
  /**
   * This pack records a `supersedesPackId`, but that ancestor is not in the
   * graph — the server omits packs the caller cannot read, and also stops at
   * the requested depth. Either way earlier lineage exists that is not shown,
   * and a surface that renders the chain as complete would be lying.
   *
   * The two causes are indistinguishable from the payload, so the label must
   * cover both rather than claiming a permission problem.
   */
  hasHiddenAncestor: boolean;
}

/**
 * `none` — nothing to draw beyond the pack itself.
 * `linear` — a chain (and/or rendered outputs); renders as a vertical list.
 *
 * There is deliberately no branching form. `buildPackProvenanceGraph` follows
 * the single `supersedesPackId` pointer strictly upward — one parent per pack —
 * and never queries descendants, so the response is always a linear ancestor
 * chain. Multiple outgoing `supersedes` edges are impossible (it is one
 * column), and multiple incoming edges are unreachable from a single root
 * walking up. A branching form would require expanding the server traversal
 * and its contract first.
 */
export type LineageForm = 'none' | 'linear';

export interface Lineage {
  form: LineageForm;
  /** Newest first; `spine[0]` is the root when the root is present. */
  spine: SpineNode[];
  /** Rendered outputs keyed by their source pack's **node id**. */
  renderedByPackId: Record<string, SpineNode[]>;
}

function creatorOf(node: ProvenanceGraphNode): ProvenanceGraphCreator | null {
  if (!('creator' in node.meta)) return null;
  return node.meta.creator ?? null;
}

function toSpineNode(
  node: ProvenanceGraphNode,
  isRoot: boolean,
  entryCount: number,
  hasHiddenAncestor = false,
): SpineNode | null {
  if (node.kind === 'pack') {
    return {
      id: node.id,
      kind: 'pack',
      label: node.label,
      cid: node.cid,
      pinned: node.meta.pinned,
      expiresAt: node.meta.expiresAt,
      createdAt: node.meta.createdAt,
      isRoot,
      entryCount,
      creator: creatorOf(node),
      packId: node.meta.packId,
      hasHiddenAncestor,
    };
  }

  if (node.kind === 'rendered_pack') {
    return {
      id: node.id,
      kind: 'rendered_pack',
      label: node.label,
      cid: node.cid,
      pinned: node.meta.pinned,
      expiresAt: node.meta.expiresAt,
      createdAt: node.meta.createdAt,
      isRoot: false,
      entryCount: 0,
      creator: creatorOf(node),
      renderedPackId: node.meta.renderedPackId,
      hasHiddenAncestor: false,
    };
  }

  // Entry nodes are membership, not lineage.
  return null;
}

export function buildLineage(graph: ProvenanceGraph): Lineage {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const rootId = graph.metadata.rootNodeId;

  const entryCounts = new Map<string, number>();
  const supersedesFrom = new Map<string, string[]>();
  const renderedFrom = new Map<string, string[]>();

  for (const edge of graph.edges) {
    if (edge.kind === 'includes') {
      entryCounts.set(edge.from, (entryCounts.get(edge.from) ?? 0) + 1);
      continue;
    }
    if (edge.kind === 'supersedes') {
      supersedesFrom.set(edge.from, [
        ...(supersedesFrom.get(edge.from) ?? []),
        edge.to,
      ]);
      continue;
    }
    if (edge.kind === 'rendered_from') {
      renderedFrom.set(edge.from, [
        ...(renderedFrom.get(edge.from) ?? []),
        edge.to,
      ]);
    }
  }

  // Walk the supersession chain from the root, newest first. `seen` guards a
  // cyclic chain: the server should never emit one, but a client that loops
  // forever on bad data is a worse failure than one that renders a short chain.
  const spine: SpineNode[] = [];
  const seen = new Set<string>();
  const queue: string[] = nodeById.has(rootId) ? [rootId] : [];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (currentId === undefined || seen.has(currentId)) continue;
    seen.add(currentId);

    const node = nodeById.get(currentId);
    if (!node) continue;

    // A recorded ancestor with no edge to a node we actually have means the
    // chain continues past what the server returned.
    const reachedAncestors = (supersedesFrom.get(currentId) ?? []).filter(
      (id) => nodeById.has(id),
    );
    const hasHiddenAncestor =
      node.kind === 'pack' &&
      node.meta.supersedesPackId !== null &&
      reachedAncestors.length === 0;

    const spineNode = toSpineNode(
      node,
      currentId === rootId,
      entryCounts.get(currentId) ?? 0,
      hasHiddenAncestor,
    );
    if (spineNode) spine.push(spineNode);

    for (const nextId of supersedesFrom.get(currentId) ?? []) {
      if (!seen.has(nextId)) queue.push(nextId);
    }
  }

  // Rendered outputs hang off their source pack rather than joining the spine:
  // they are a different axis (one pack, several renderings) from supersession
  // (one pack replacing another over time).
  const renderedByPackId: Record<string, SpineNode[]> = {};
  for (const spineNode of spine) {
    const renderedIds = renderedFrom.get(spineNode.id) ?? [];
    const rendered = renderedIds
      .map((id) => nodeById.get(id))
      .filter((node): node is ProvenanceGraphNode => node !== undefined)
      .map((node) => toSpineNode(node, false, 0))
      .filter((node): node is SpineNode => node !== null);

    if (rendered.length > 0) renderedByPackId[spineNode.id] = rendered;
  }

  const hasRendered = Object.keys(renderedByPackId).length > 0;
  const hasSupersession = spine.length > 1;
  // A pack whose only ancestor is hidden still *has* lineage. Reporting `none`
  // would render "no lineage yet", which is false — the chain must render so
  // the gap marker can say earlier packs exist but are not shown.
  const hasHiddenLineage = spine.some((node) => node.hasHiddenAncestor);

  const form: LineageForm =
    hasSupersession || hasRendered || hasHiddenLineage ? 'linear' : 'none';

  return { form, spine, renderedByPackId };
}
