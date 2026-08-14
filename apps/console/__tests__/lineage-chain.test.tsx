import { render, screen, within } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ pinMutate: vi.fn() }));

vi.mock('../src/packs/hooks.js', () => ({
  usePinPack: () => ({
    mutate: mocks.pinMutate,
    isPending: false,
    isError: false,
    isSuccess: false,
  }),
}));

vi.mock('../src/config.js', () => ({
  getConfig: () => ({ docsUrl: 'https://docs.example.test', packGcTtlDays: 7 }),
}));

import { LineageChain } from '../src/components/packs/LineageChain.js';
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

const NOW = new Date('2026-08-14T00:00:00.000Z');

const renderChain = (graph: Parameters<typeof buildLineage>[0]) =>
  render(
    <MoltThemeProvider>
      <LineageChain lineage={buildLineage(graph)} now={NOW} />
    </MoltThemeProvider>,
  );

beforeEach(() => vi.clearAllMocks());

describe('LineageChain', () => {
  it('exposes the lineage as an ordered list, not only as a picture', () => {
    const graph = graphFixture({
      nodes: [packNode('p2'), packNode('p1')],
      edges: [edge(packNodeId('p2'), packNodeId('p1'), 'supersedes')],
      rootSeed: 'p2',
    });

    renderChain(graph);

    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('orders the chain newest first', () => {
    const graph = graphFixture({
      nodes: [
        packNode('p2', { packType: 'optimized' }),
        packNode('p1', { packType: 'compile' }),
      ],
      edges: [edge(packNodeId('p2'), packNodeId('p1'), 'supersedes')],
      rootSeed: 'p2',
    });

    renderChain(graph);

    const items = screen.getAllByRole('listitem');
    expect(within(items[0]!).getByText(/optimized/)).toBeInTheDocument();
    expect(within(items[1]!).getByText(/compile/)).toBeInTheDocument();
  });

  it('marks the pack being viewed as current', () => {
    const graph = graphFixture({
      nodes: [packNode('p2'), packNode('p1')],
      edges: [edge(packNodeId('p2'), packNodeId('p1'), 'supersedes')],
      rootSeed: 'p2',
    });

    renderChain(graph);

    const items = screen.getAllByRole('listitem');
    expect(within(items[0]!).getByText(/current/i)).toBeInTheDocument();
    expect(within(items[1]!).queryByText(/current/i)).not.toBeInTheDocument();
  });

  it('renders lifecycle state per node through DecayBadge', () => {
    const graph = graphFixture({
      nodes: [
        packNode('p2', { pinned: true }),
        packNode('p1', { expiresAt: '2026-08-18T00:00:00.000Z' }),
      ],
      edges: [edge(packNodeId('p2'), packNodeId('p1'), 'supersedes')],
      rootSeed: 'p2',
    });

    renderChain(graph);

    expect(screen.getByText('Pinned')).toBeInTheDocument();
    expect(screen.getByText(/Expires in 4 days/)).toBeInTheDocument();
  });

  it('offers a pin control on every context pack in the chain', () => {
    const graph = graphFixture({
      nodes: [packNode('p2'), packNode('p1')],
      edges: [edge(packNodeId('p2'), packNodeId('p1'), 'supersedes')],
      rootSeed: 'p2',
    });

    renderChain(graph);

    // Retention is a chain-level decision: every ancestor is actionable here,
    // not just the pack the operator navigated to.
    expect(
      screen.getAllByRole('button', {
        name: /keep this pack past its expiry/i,
      }),
    ).toHaveLength(2);
  });

  it('renders rendered packs read-only, with no pin control', () => {
    const graph = graphFixture({
      nodes: [packNode('p1'), renderedPackNode('r1', 'p1')],
      edges: [
        edge(packNodeId('p1'), renderedPackNodeId('r1'), 'rendered_from'),
      ],
    });

    renderChain(graph);

    expect(screen.getByText(/markdown/)).toBeInTheDocument();
    // One control for the pack, none for its rendering (usePinRenderedPack has
    // no control yet — that belongs with #655).
    expect(
      screen.getAllByRole('button', { name: /pack past its expiry/i }),
    ).toHaveLength(1);
  });

  it('nests rendered packs under the pack they were rendered from', () => {
    const graph = graphFixture({
      nodes: [packNode('p1'), renderedPackNode('r1', 'p1')],
      edges: [
        edge(packNodeId('p1'), renderedPackNodeId('r1'), 'rendered_from'),
      ],
    });

    renderChain(graph);

    const [packItem] = screen.getAllByRole('listitem');
    expect(within(packItem!).getByText(/markdown/)).toBeInTheDocument();
  });

  it('reports how many entries each pack selected', () => {
    const graph = graphFixture({
      nodes: [packNode('p1'), entryNode('e1'), entryNode('e2')],
      edges: [
        edge(packNodeId('p1'), entryNodeId('e1'), 'includes'),
        edge(packNodeId('p1'), entryNodeId('e2'), 'includes'),
      ],
    });

    renderChain(graph);

    expect(screen.getByText(/2 entries/)).toBeInTheDocument();
  });

  it('uses the singular for a single entry', () => {
    const graph = graphFixture({
      nodes: [packNode('p1'), entryNode('e1')],
      edges: [edge(packNodeId('p1'), entryNodeId('e1'), 'includes')],
    });

    renderChain(graph);

    expect(screen.getByText(/1 entry(?!\w)/)).toBeInTheDocument();
  });

  it('attributes each node to its creator', () => {
    const graph = graphFixture({ nodes: [packNode('p1')], edges: [] });

    renderChain(graph);

    expect(screen.getByText(/1671-B080-99BF-4270/)).toBeInTheDocument();
  });
});
