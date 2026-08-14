import { render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ provenance: {} as Record<string, unknown> }));

vi.mock('../src/packs/hooks.js', () => ({
  usePackProvenance: () => mocks.provenance,
  usePinPack: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
  }),
}));

vi.mock('../src/config.js', () => ({
  getConfig: () => ({ docsUrl: 'https://docs.example.test', packGcTtlDays: 7 }),
}));

import { PackLineage } from '../src/components/packs/PackLineage.js';
import {
  edge,
  graphFixture,
  packNode,
  packNodeId,
} from './fixtures/provenance.js';

const NOW = new Date('2026-08-14T00:00:00.000Z');

const renderPanel = () =>
  render(
    <MoltThemeProvider>
      <PackLineage packId="pack-1" now={NOW} />
    </MoltThemeProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.provenance = { isLoading: false, isError: false, data: undefined };
});

describe('PackLineage', () => {
  it('announces the loading state', () => {
    mocks.provenance = { isLoading: true, isError: false, data: undefined };

    renderPanel();

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('surfaces the API problem detail on error', () => {
    // The generated client throws the parsed body, not an Error instance.
    mocks.provenance = {
      isLoading: false,
      isError: true,
      error: { detail: 'Forbidden for this team', title: 'Forbidden' },
      data: undefined,
    };

    renderPanel();

    expect(screen.getByText('Forbidden for this team')).toBeInTheDocument();
  });

  it('offers a retry when lineage fails to load', () => {
    mocks.provenance = {
      isLoading: false,
      isError: true,
      error: { detail: 'Upstream timeout' },
      data: undefined,
      refetch: vi.fn(),
    };

    renderPanel();

    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('explains the absence rather than drawing an empty chain', () => {
    mocks.provenance = {
      isLoading: false,
      isError: false,
      data: graphFixture({ nodes: [packNode('p1')], edges: [] }),
    };

    renderPanel();

    expect(
      screen.getByText(/Nothing has replaced this pack/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('renders the chain for linear lineage', () => {
    mocks.provenance = {
      isLoading: false,
      isError: false,
      data: graphFixture({
        nodes: [packNode('p2'), packNode('p1')],
        edges: [edge(packNodeId('p2'), packNodeId('p1'), 'supersedes')],
        rootSeed: 'p2',
      }),
    };

    renderPanel();

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('renders branching lineage rather than nothing while the graph form is pending', () => {
    mocks.provenance = {
      isLoading: false,
      isError: false,
      data: graphFixture({
        nodes: [packNode('p2'), packNode('p1'), packNode('p0')],
        edges: [
          edge(packNodeId('p2'), packNodeId('p1'), 'supersedes'),
          edge(packNodeId('p2'), packNodeId('p0'), 'supersedes'),
        ],
        rootSeed: 'p2',
      }),
    };

    renderPanel();

    // Flattened, but every pack is listed and actionable. The graph form
    // replaces this rendering.
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('marks a chain truncated by depth or permission instead of implying it is complete', () => {
    mocks.provenance = {
      isLoading: false,
      isError: false,
      data: graphFixture({
        nodes: [packNode('p1', { supersedesPackId: 'an-older-pack' })],
        edges: [],
      }),
    };

    renderPanel();

    expect(screen.getByText(/isn’t shown/)).toBeInTheDocument();
    expect(
      screen.queryByText(/Nothing has replaced this pack/),
    ).not.toBeInTheDocument();
  });
});
