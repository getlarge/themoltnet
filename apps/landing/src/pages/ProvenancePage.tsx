import type { ProvenanceGraph, ProvenanceGraphNode } from '@moltnet/models';
import {
  Badge,
  Button,
  Card,
  Container,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import type { ChangeEvent } from 'react';
import { Fragment, useDeferredValue, useState } from 'react';
import { Link } from 'wouter';

import { buildGraphLayout } from '../provenance/graph-layout';
import { parseProvenanceGraph } from '../provenance/parse-graph';
import { sampleProvenanceGraph } from '../provenance/sample-graph';

const sampleJson = JSON.stringify(sampleProvenanceGraph, null, 2);
const NODE_WIDTH = 224;
const NODE_HEIGHT = 84;

function nodeFill(kind: ProvenanceGraphNode['kind']): string {
  return kind === 'pack'
    ? 'rgba(230, 168, 23, 0.14)'
    : 'rgba(97, 201, 168, 0.14)';
}

function nodeStroke(kind: ProvenanceGraphNode['kind']): string {
  return kind === 'pack' ? '#e6a817' : '#61c9a8';
}

function edgeStroke(kind: 'includes' | 'supersedes'): string {
  return kind === 'supersedes' ? '#e6a817' : '#7dd3fc';
}

function summarizeValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    const parts = value.map((item) =>
      typeof item === 'object' && item !== null
        ? JSON.stringify(item)
        : String(item),
    );
    return parts.join(', ') || '[]';
  }
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  return 'unsupported';
}

export function ProvenancePage() {
  const theme = useTheme();
  const [rawInput, setRawInput] = useState(sampleJson);
  const [selectedNodeId, setSelectedNodeId] = useState('pack:compile-2');
  const deferredInput = useDeferredValue(rawInput);

  const parsed = (() => {
    try {
      const graph = parseProvenanceGraph(deferredInput);
      return { graph, error: null as string | null };
    } catch (error) {
      return {
        graph: null,
        error: error instanceof Error ? error.message : 'Failed to parse graph',
      };
    }
  })();

  const graph = parsed.graph;
  const selectedNode =
    graph?.nodes.find((node) => node.id === selectedNodeId) ??
    graph?.nodes[0] ??
    null;
  const layout = graph ? buildGraphLayout(graph) : null;

  async function handleFileUpload(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;

    setRawInput(await file.text());
    event.target.value = '';
  }

  function renderGraph(current: ProvenanceGraph) {
    const currentLayout = buildGraphLayout(current);
    const position = currentLayout.positions;

    return (
      <svg
        width={currentLayout.width}
        height={currentLayout.height}
        viewBox={`0 0 ${currentLayout.width} ${currentLayout.height}`}
        style={{
          width: '100%',
          minWidth: `${currentLayout.width}px`,
          height: `${currentLayout.height}px`,
          display: 'block',
          background:
            'radial-gradient(circle at top left, rgba(230, 168, 23, 0.1), transparent 28%), linear-gradient(180deg, rgba(11, 17, 32, 0.96), rgba(7, 10, 18, 1))',
        }}
      >
        {current.edges.map((edge) => {
          const from = position[edge.from];
          const to = position[edge.to];
          if (!from || !to) return null;

          const x1 = from.x + NODE_WIDTH;
          const y1 = from.y + NODE_HEIGHT / 2;
          const x2 = to.x;
          const y2 = to.y + NODE_HEIGHT / 2;
          const midX = (x1 + x2) / 2;

          return (
            <g key={edge.id}>
              <path
                d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={edgeStroke(edge.kind)}
                strokeDasharray={edge.kind === 'supersedes' ? '8 6' : undefined}
                strokeOpacity={0.8}
                strokeWidth={2.5}
              />
              {edge.label ? (
                <text
                  x={midX}
                  y={(y1 + y2) / 2 - 8}
                  fill="rgba(255,255,255,0.72)"
                  fontFamily={theme.font.family.mono}
                  fontSize={12}
                  textAnchor="middle"
                >
                  {edge.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {current.nodes.map((node) => {
          const currentPosition = position[node.id];
          if (!currentPosition) return null;

          const selected = node.id === selectedNode?.id;

          return (
            <g
              key={node.id}
              onClick={() => setSelectedNodeId(node.id)}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={currentPosition.x}
                y={currentPosition.y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={20}
                fill={nodeFill(node.kind)}
                stroke={nodeStroke(node.kind)}
                strokeOpacity={selected ? 1 : 0.7}
                strokeWidth={selected ? 3 : 2}
              />
              <text
                x={currentPosition.x + 16}
                y={currentPosition.y + 26}
                fill="#f5f7fb"
                fontFamily={theme.font.family.sans}
                fontSize={16}
                fontWeight={600}
              >
                {node.label.slice(0, 26)}
              </text>
              <text
                x={currentPosition.x + 16}
                y={currentPosition.y + 48}
                fill="rgba(255,255,255,0.72)"
                fontFamily={theme.font.family.mono}
                fontSize={12}
              >
                {node.kind}
              </text>
              <text
                x={currentPosition.x + 16}
                y={currentPosition.y + 66}
                fill="rgba(255,255,255,0.58)"
                fontFamily={theme.font.family.mono}
                fontSize={11}
              >
                {node.cid?.slice(0, 22) ?? 'no cid'}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  return (
    <div
      style={{
        paddingTop: '5rem',
        minHeight: '100vh',
        background:
          'linear-gradient(180deg, #0b1120 0%, #0e1528 52%, #060811 100%)',
      }}
    >
      <Container maxWidth="lg">
        <Stack
          gap={6}
          style={{ padding: `${theme.spacing[10]} 0 ${theme.spacing[16]}` }}
        >
          <Stack gap={2}>
            <Link
              href="/architecture"
              style={{
                fontSize: theme.font.size.sm,
                color: theme.color.text.muted,
              }}
            >
              &larr; Back to architecture
            </Link>
            <Badge variant="accent">Lab</Badge>
            <Text variant="h2">Provenance Graph Viewer</Text>
            <Text variant="body" color="secondary">
              Upload or paste a `moltnet.provenance-graph/v1` payload and
              inspect pack ancestry plus pack-to-entry membership.
            </Text>
          </Stack>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(300px, 420px) minmax(0, 1fr)',
              gap: theme.spacing[6],
              alignItems: 'start',
            }}
          >
            <Stack gap={4}>
              <Card
                style={{
                  padding: theme.spacing[5],
                  background: 'rgba(9, 14, 27, 0.88)',
                  border: '1px solid rgba(230, 168, 23, 0.18)',
                }}
              >
                <Stack gap={3}>
                  <Text variant="h4">Graph Input</Text>
                  <Text variant="caption" color="secondary">
                    Start with the bundled sample or export a real pack graph
                    with `pnpm --filter @moltnet/tools graph:provenance`.
                  </Text>
                  <div
                    style={{
                      display: 'flex',
                      gap: theme.spacing[2],
                      flexWrap: 'wrap',
                    }}
                  >
                    <Button
                      onClick={() => setRawInput(sampleJson)}
                      variant="accent"
                    >
                      Load Sample
                    </Button>
                    <label
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: theme.spacing[2],
                        borderRadius: theme.radius.md,
                        border: `1px solid ${theme.color.border.DEFAULT}`,
                        padding: `${theme.spacing[2]} ${theme.spacing[4]}`,
                        cursor: 'pointer',
                        color: theme.color.primary.DEFAULT,
                      }}
                    >
                      <span>Upload JSON</span>
                      <input
                        type="file"
                        accept="application/json,.json"
                        onChange={handleFileUpload}
                        style={{ display: 'none' }}
                      />
                    </label>
                  </div>
                  <textarea
                    value={rawInput}
                    onChange={(event) => setRawInput(event.target.value)}
                    spellCheck={false}
                    style={{
                      minHeight: '24rem',
                      width: '100%',
                      resize: 'vertical',
                      borderRadius: theme.radius.lg,
                      border: `1px solid ${theme.color.border.DEFAULT}`,
                      background: 'rgba(4, 8, 15, 0.94)',
                      color: theme.color.text.DEFAULT,
                      padding: theme.spacing[4],
                      fontFamily: theme.font.family.mono,
                      fontSize: theme.font.size.xs,
                    }}
                  />
                  {parsed.error ? (
                    <Text variant="caption" style={{ color: '#f87171' }}>
                      {parsed.error}
                    </Text>
                  ) : null}
                </Stack>
              </Card>

              {selectedNode ? (
                <Card
                  style={{
                    padding: theme.spacing[5],
                    background: 'rgba(9, 14, 27, 0.88)',
                  }}
                >
                  <Stack gap={3}>
                    <Text variant="h4">Selected Node</Text>
                    <Badge
                      variant={
                        selectedNode.kind === 'pack' ? 'accent' : 'primary'
                      }
                    >
                      {selectedNode.kind}
                    </Badge>
                    <Text variant="body">{selectedNode.label}</Text>
                    <Text variant="caption" color="secondary">
                      {selectedNode.id}
                    </Text>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(96px, 120px) 1fr',
                        gap: theme.spacing[2],
                      }}
                    >
                      {Object.entries(selectedNode.meta).map(([key, value]) => (
                        <Fragment key={key}>
                          <Text variant="caption" color="secondary">
                            {key}
                          </Text>
                          <Text
                            variant="caption"
                            style={{
                              fontFamily:
                                typeof value === 'string' && value.length > 18
                                  ? theme.font.family.mono
                                  : theme.font.family.sans,
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {summarizeValue(value)}
                          </Text>
                        </Fragment>
                      ))}
                    </div>
                  </Stack>
                </Card>
              ) : null}
            </Stack>

            <Stack gap={4}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                  gap: theme.spacing[3],
                }}
              >
                <Card
                  style={{
                    padding: theme.spacing[4],
                    background: 'rgba(9, 14, 27, 0.88)',
                  }}
                >
                  <Text variant="overline" color="accent">
                    Root
                  </Text>
                  <Text variant="caption">
                    {graph?.metadata.rootNodeId ?? 'n/a'}
                  </Text>
                </Card>
                <Card
                  style={{
                    padding: theme.spacing[4],
                    background: 'rgba(9, 14, 27, 0.88)',
                  }}
                >
                  <Text variant="overline" color="accent">
                    Nodes
                  </Text>
                  <Text variant="h4">{graph?.nodes.length ?? 0}</Text>
                </Card>
                <Card
                  style={{
                    padding: theme.spacing[4],
                    background: 'rgba(9, 14, 27, 0.88)',
                  }}
                >
                  <Text variant="overline" color="accent">
                    Edges
                  </Text>
                  <Text variant="h4">{graph?.edges.length ?? 0}</Text>
                </Card>
                <Card
                  style={{
                    padding: theme.spacing[4],
                    background: 'rgba(9, 14, 27, 0.88)',
                  }}
                >
                  <Text variant="overline" color="accent">
                    Depth
                  </Text>
                  <Text variant="h4">{graph?.metadata.depth ?? 0}</Text>
                </Card>
              </div>

              <Card
                style={{
                  overflow: 'auto',
                  padding: theme.spacing[4],
                  background: 'rgba(9, 14, 27, 0.88)',
                  border: '1px solid rgba(97, 201, 168, 0.18)',
                }}
              >
                {graph && layout ? renderGraph(graph) : null}
              </Card>
            </Stack>
          </div>
        </Stack>
      </Container>
    </div>
  );
}
