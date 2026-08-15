import { buildGraphLayout } from '@moltnet/provenance-ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { App } from '../src/App';
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
    ).toThrow('Invalid provenance graph');
  });

  it('rejects duplicate IDs and a mismatched root pack', () => {
    const duplicateNodes = {
      ...sampleProvenanceGraph,
      nodes: [sampleProvenanceGraph.nodes[0], sampleProvenanceGraph.nodes[0]],
      edges: [],
    };
    expect(() => parseProvenanceGraph(JSON.stringify(duplicateNodes))).toThrow(
      'unique ID',
    );

    const mismatchedRoot = {
      ...sampleProvenanceGraph,
      metadata: {
        ...sampleProvenanceGraph.metadata,
        rootPackId: '99999999-9999-4999-8999-999999999999',
      },
    };
    expect(() => parseProvenanceGraph(JSON.stringify(mismatchedRoot))).toThrow(
      'declared root',
    );
  });

  it('rejects creator metadata that does not match a principal kind', () => {
    const malformedCreator = {
      ...sampleProvenanceGraph,
      nodes: sampleProvenanceGraph.nodes.map((node, index) =>
        index === 0
          ? {
              ...node,
              meta: {
                ...node.meta,
                creator: {
                  identityId: '99999999-9999-4999-8999-999999999999',
                  fingerprint: 'C212-DAFA-27C5-6C57',
                  publicKey: 'ed25519:test',
                },
              },
            }
          : node,
      ),
    };

    expect(() =>
      parseProvenanceGraph(JSON.stringify(malformedCreator)),
    ).toThrow('Invalid provenance graph');
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

    expect(screen.getByText('Provenance explorer')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), {
      target: {
        value: JSON.stringify(sampleProvenanceGraph, null, 2),
      },
    });
    const graphHeading = screen.getByText('Provenance graph');
    expect(graphHeading).toBeInTheDocument();
    expect(screen.getByText('Fit view')).toBeInTheDocument();
    expect(screen.getByText('Imported · unverified')).toBeInTheDocument();
    expect(screen.getByText('C212-DAFA-27C5-6C57')).toBeInTheDocument();
    expect(screen.getAllByText('compile pack v2').length).toBeGreaterThan(0);

    const sourceSummary = screen.getByText('Imported JSON');
    const sourceDrawer = sourceSummary.closest('details');
    expect(sourceDrawer).not.toHaveAttribute('open');
    expect(
      graphHeading.compareDocumentPosition(sourceSummary) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(sourceSummary);

    expect(sourceDrawer).toHaveAttribute('open');
    expect(
      screen.getByRole('textbox', { name: 'Provenance graph JSON' }),
    ).toBeInTheDocument();
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
    fireEvent.click(
      screen.getByRole('button', { name: 'Hide 2 included entries' }),
    );

    expect(screen.queryByText('MCP server notes')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show 2 included entries' }),
    ).toBeInTheDocument();
  });

  it('activates graph nodes from the keyboard', () => {
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

    const entryNode = screen.getByRole('button', {
      name: /entry node: identity bootstrap/i,
    });

    fireEvent.keyDown(entryNode, { key: 'Enter' });

    expect(entryNode).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'Identity bootstrap' })).toBe(
      screen.getByText('Identity bootstrap', { selector: 'h4' }),
    );
  });

  it('associates invalid input with an announced error', () => {
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

    const input = screen.getByRole('textbox', {
      name: 'Provenance graph JSON',
    });
    fireEvent.change(input, { target: { value: '{not valid json' } });

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain(
      'provenance-json-error',
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
