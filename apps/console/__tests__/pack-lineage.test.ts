import { describe, expect, it } from 'vitest';

import { buildLineage } from '../src/packs/lineage.js';
import {
  edge,
  entryNode,
  entryNodeId,
  graphFixture,
  packNode,
  packNodeId,
  renderedPackNode,
  renderedPackNodeId,
} from './fixtures/provenance.js';

describe('buildLineage', () => {
  describe('form selection', () => {
    it('reports "none" for a root pack with no supersession and no renders', () => {
      const graph = graphFixture({ nodes: [packNode('p1')], edges: [] });

      expect(buildLineage(graph).form).toBe('none');
    });

    it('reports "none" when the pack only includes entries', () => {
      const graph = graphFixture({
        nodes: [packNode('p1'), entryNode('e1')],
        edges: [edge(packNodeId('p1'), entryNodeId('e1'), 'includes')],
      });

      // Entries never constitute lineage.
      expect(buildLineage(graph).form).toBe('none');
    });

    it('reports "linear" for a single supersession hop', () => {
      const graph = graphFixture({
        nodes: [packNode('p1'), packNode('p0')],
        edges: [edge(packNodeId('p1'), packNodeId('p0'), 'supersedes')],
      });

      expect(buildLineage(graph).form).toBe('linear');
    });

    it('reports "linear" when a pack has rendered outputs but no supersession', () => {
      const graph = graphFixture({
        nodes: [packNode('p1'), renderedPackNode('r1', 'p1')],
        edges: [
          edge(packNodeId('p1'), renderedPackNodeId('r1'), 'rendered_from'),
        ],
      });

      expect(buildLineage(graph).form).toBe('linear');
    });

    it('reports "branching" when one pack supersedes two', () => {
      const graph = graphFixture({
        nodes: [packNode('p2'), packNode('p1'), packNode('p0')],
        edges: [
          edge(packNodeId('p2'), packNodeId('p1'), 'supersedes'),
          edge(packNodeId('p2'), packNodeId('p0'), 'supersedes'),
        ],
        rootSeed: 'p2',
      });

      expect(buildLineage(graph).form).toBe('branching');
    });

    it('reports "branching" when two packs supersede the same ancestor', () => {
      const graph = graphFixture({
        nodes: [packNode('p2'), packNode('p1'), packNode('p0')],
        edges: [
          edge(packNodeId('p2'), packNodeId('p0'), 'supersedes'),
          edge(packNodeId('p1'), packNodeId('p0'), 'supersedes'),
        ],
        rootSeed: 'p2',
      });

      expect(buildLineage(graph).form).toBe('branching');
    });
  });

  describe('spine composition', () => {
    it('drops entry nodes from the spine', () => {
      const graph = graphFixture({
        nodes: [packNode('p1'), entryNode('e1'), entryNode('e2')],
        edges: [
          edge(packNodeId('p1'), entryNodeId('e1'), 'includes'),
          edge(packNodeId('p1'), entryNodeId('e2'), 'includes'),
        ],
      });

      expect(buildLineage(graph).spine.map((n) => n.id)).toEqual([
        packNodeId('p1'),
      ]);
    });

    it('counts included entries per spine node', () => {
      const graph = graphFixture({
        nodes: [packNode('p1'), entryNode('e1'), entryNode('e2')],
        edges: [
          edge(packNodeId('p1'), entryNodeId('e1'), 'includes'),
          edge(packNodeId('p1'), entryNodeId('e2'), 'includes'),
        ],
      });

      expect(buildLineage(graph).spine[0]?.entryCount).toBe(2);
    });

    it('orders a chain newest first, with the root flagged', () => {
      const graph = graphFixture({
        nodes: [packNode('p2'), packNode('p1'), packNode('p0')],
        edges: [
          edge(packNodeId('p2'), packNodeId('p1'), 'supersedes'),
          edge(packNodeId('p1'), packNodeId('p0'), 'supersedes'),
        ],
        rootSeed: 'p2',
      });

      const lineage = buildLineage(graph);

      expect(lineage.spine.map((n) => n.id)).toEqual([
        packNodeId('p2'),
        packNodeId('p1'),
        packNodeId('p0'),
      ]);
      expect(lineage.spine[0]?.isRoot).toBe(true);
      expect(lineage.spine[1]?.isRoot).toBe(false);
    });

    it('carries lifecycle state through to each spine node', () => {
      const graph = graphFixture({
        nodes: [
          packNode('p1', { pinned: true }),
          packNode('p0', { expiresAt: '2026-09-01T00:00:00.000Z' }),
        ],
        edges: [edge(packNodeId('p1'), packNodeId('p0'), 'supersedes')],
      });

      const lineage = buildLineage(graph);

      expect(lineage.spine[0]).toMatchObject({ pinned: true, expiresAt: null });
      expect(lineage.spine[1]).toMatchObject({
        pinned: false,
        expiresAt: '2026-09-01T00:00:00.000Z',
      });
    });

    it('exposes the pack id so the node can drive a pin control', () => {
      const graph = graphFixture({ nodes: [packNode('p1')], edges: [] });

      expect(buildLineage(graph).spine[0]?.packId).toBe(
        packNodeId('p1').replace('pack:', ''),
      );
    });
  });

  describe('rendered packs', () => {
    it('groups rendered packs under their source without putting them on the spine', () => {
      const graph = graphFixture({
        nodes: [packNode('p1'), renderedPackNode('r1', 'p1')],
        edges: [
          edge(packNodeId('p1'), renderedPackNodeId('r1'), 'rendered_from'),
        ],
      });

      const lineage = buildLineage(graph);

      expect(lineage.spine.map((n) => n.id)).toEqual([packNodeId('p1')]);
      expect(
        lineage.renderedByPackId[packNodeId('p1')]?.map((n) => n.id),
      ).toEqual([renderedPackNodeId('r1')]);
    });

    it('marks rendered packs as their own kind so callers can render them read-only', () => {
      const graph = graphFixture({
        nodes: [packNode('p1'), renderedPackNode('r1', 'p1')],
        edges: [
          edge(packNodeId('p1'), renderedPackNodeId('r1'), 'rendered_from'),
        ],
      });

      const rendered = buildLineage(graph).renderedByPackId[packNodeId('p1')];

      expect(rendered?.[0]?.kind).toBe('rendered_pack');
      expect(rendered?.[0]?.packId).toBeUndefined();
    });
  });

  describe('degenerate input', () => {
    it('returns an empty spine when the root node is missing from nodes', () => {
      const graph = graphFixture({ nodes: [packNode('p9')], edges: [] });

      // rootNodeId defaults to pack:p1, which is not present.
      expect(buildLineage(graph).spine).toEqual([]);
      expect(buildLineage(graph).form).toBe('none');
    });

    it('does not loop forever on a cyclic supersedes chain', () => {
      const graph = graphFixture({
        nodes: [packNode('p1'), packNode('p0')],
        edges: [
          edge(packNodeId('p1'), packNodeId('p0'), 'supersedes'),
          edge(packNodeId('p0'), packNodeId('p1'), 'supersedes'),
        ],
      });

      expect(buildLineage(graph).spine).toHaveLength(2);
    });
  });
});
