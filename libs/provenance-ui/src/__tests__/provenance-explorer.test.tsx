import type { ProvenanceGraph } from '@moltnet/models';
import { fireEvent, render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it, vi } from 'vitest';

import { buildGraphLayout } from '../graph-layout.js';
import { filterCollapsedGraph } from '../graph-utils.js';
import { ProvenanceExplorer } from '../ProvenanceExplorer.js';

const graph: ProvenanceGraph = {
  metadata: {
    format: 'moltnet.provenance-graph/v1',
    generatedAt: '2026-08-15T00:00:00.000Z',
    rootNodeId: 'pack:current',
    rootPackId: '00000000-0000-4000-8000-000000000001',
    depth: 2,
  },
  nodes: [
    {
      id: 'pack:current',
      kind: 'pack',
      label: 'Current context pack',
      cid: 'bafy-current',
      meta: {
        packId: '00000000-0000-4000-8000-000000000001',
        diaryId: '00000000-0000-4000-8000-000000000002',
        packCid: 'bafy-current',
        packType: 'compile',
        packCodec: 'dag-json',
        pinned: false,
        createdAt: '2026-08-15T00:00:00.000Z',
        expiresAt: null,
        supersedesPackId: null,
      },
    },
    {
      id: 'entry:evidence',
      kind: 'entry',
      label: 'Evidence entry',
      cid: 'bafy-entry',
      meta: {
        entryId: '00000000-0000-4000-8000-000000000003',
        diaryId: '00000000-0000-4000-8000-000000000002',
        entryType: 'semantic',
        contentHash: 'bafy-entry',
        createdAt: '2026-08-14T00:00:00.000Z',
        updatedAt: '2026-08-14T00:00:00.000Z',
        signed: true,
        title: 'Evidence entry',
        tags: ['proof'],
      },
    },
  ],
  edges: [
    {
      id: 'includes:evidence',
      from: 'pack:current',
      to: 'entry:evidence',
      kind: 'includes',
    },
  ],
};

function renderExplorer(renderNodeActions?: () => React.ReactNode) {
  return render(
    <MoltThemeProvider mode="dark">
      <ProvenanceExplorer
        graph={graph}
        height="24rem"
        renderNodeActions={renderNodeActions}
      />
    </MoltThemeProvider>,
  );
}

describe('ProvenanceExplorer', () => {
  it('lays membership evidence after its root pack', () => {
    const layout = buildGraphLayout(graph);

    expect(layout.positions['pack:current'].x).toBeLessThan(
      layout.positions['entry:evidence'].x,
    );
  });

  it('removes a collapsed pack entry fanout without changing the source graph', () => {
    const filtered = filterCollapsedGraph(graph, new Set(['pack:current']));

    expect(filtered.nodes.map((node) => node.id)).toEqual(['pack:current']);
    expect(filtered.edges).toEqual([]);
    expect(graph.nodes).toHaveLength(2);
  });

  it('shares keyboard selection, collapse, and an accessible outline', () => {
    renderExplorer();

    const packNode = screen.getByRole('button', {
      name: /pack node: current context pack/i,
    });
    fireEvent.keyDown(packNode, { key: 'Enter' });

    expect(screen.queryByText('Evidence entry')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Expand entries' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Accessible graph outline')).toBeInTheDocument();
  });

  it('lets an authenticated wrapper add actions for the selected node', () => {
    const action = vi.fn(() => (
      <button type="button">Pin selected pack</button>
    ));

    renderExplorer(action);

    expect(
      screen.getByRole('button', { name: 'Pin selected pack' }),
    ).toBeInTheDocument();
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pack:current' }),
    );
  });
});
