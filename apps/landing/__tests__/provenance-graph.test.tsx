import { fireEvent, render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { App } from '../src/App';
import { buildGraphLayout } from '../src/provenance/graph-layout';
import { parseProvenanceGraph } from '../src/provenance/parse-graph';
import { sampleProvenanceGraph } from './fixtures/sample-provenance-graph';

describe('provenance graph utilities', () => {
  it('parses the bundled sample graph', () => {
    const parsed = parseProvenanceGraph(
      JSON.stringify(sampleProvenanceGraph, null, 2),
    );

    expect(parsed.metadata.rootNodeId).toBe('pack:compile-2');
    expect(parsed.nodes).toHaveLength(6);
    expect(parsed.edges).toHaveLength(6);
  });

  it('rejects malformed graph payloads before render time', () => {
    expect(() =>
      parseProvenanceGraph(
        JSON.stringify({
          metadata: sampleProvenanceGraph.metadata,
          nodes: [{ id: 'pack:oops' }],
          edges: [],
        }),
      ),
    ).toThrow('Invalid provenance graph payload');
  });

  it('builds a layered layout with the root pack on the left', () => {
    const layout = buildGraphLayout(sampleProvenanceGraph);

    expect(layout.positions['pack:compile-2'].x).toBeLessThan(
      layout.positions['pack:compile-1'].x,
    );
    expect(layout.positions['pack:compile-1'].x).toBeLessThan(
      layout.positions['entry:identity'].x,
    );
  });

  it('keeps rendered packs reachable from the root via outgoing edges', () => {
    const layout = buildGraphLayout(sampleProvenanceGraph);

    expect(layout.positions['pack:compile-2'].x).toBeLessThan(
      layout.positions['rendered_pack:docs-1'].x,
    );
  });
});

describe('provenance viewer route', () => {
  it('renders the provenance viewer and accepts pasted graph JSON', () => {
    const { hook } = memoryLocation({
      path: '/labs/provenance',
      record: true,
    });

    render(
      <MoltThemeProvider mode="dark">
        <Router hook={hook}>
          <App />
        </Router>
      </MoltThemeProvider>,
    );

    expect(screen.getByText('Provenance Graph Viewer')).toBeInTheDocument();
    expect(screen.getByText('Graph Surface')).toBeInTheDocument();
    expect(screen.getByText('Fit View')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), {
      target: {
        value: JSON.stringify(sampleProvenanceGraph, null, 2),
      },
    });
    expect(screen.getByText('C212-DAFA-27C5-6C57')).toBeInTheDocument();
    expect(screen.getAllByText('compile pack v2').length).toBeGreaterThan(0);
  });

  it('collapses a selected pack entry fanout', () => {
    const { hook } = memoryLocation({
      path: '/labs/provenance',
      record: true,
    });

    render(
      <MoltThemeProvider mode="dark">
        <Router hook={hook}>
          <App />
        </Router>
      </MoltThemeProvider>,
    );

    fireEvent.change(screen.getByRole('textbox'), {
      target: {
        value: JSON.stringify(sampleProvenanceGraph, null, 2),
      },
    });
    expect(screen.getByText('MCP server notes')).toBeInTheDocument();
    fireEvent.click(screen.getAllByText('compile pack v2')[0]!);

    expect(screen.queryByText('MCP server notes')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Expand Entries' }),
    ).toBeInTheDocument();
  });
});
