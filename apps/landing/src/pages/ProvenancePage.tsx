import type { ProvenanceGraph, ProvenanceGraphNode } from '@moltnet/models';
import {
  AgentIdentityMark,
  Badge,
  Button,
  Card,
  Container,
  KeyFingerprint,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import type {
  ChangeEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent,
} from 'react';
import { Fragment, useDeferredValue, useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';

import { buildGraphLayout } from '../provenance/graph-layout';
import { parseProvenanceGraph } from '../provenance/parse-graph';
import { sampleProvenanceGraph } from '../provenance/sample-graph';

const sampleJson = JSON.stringify(sampleProvenanceGraph, null, 2);
const NODE_WIDTH = 280;
const NODE_HEIGHT = 116;
const NODE_LABEL_MAX = 30;
const VIEWPORT_PADDING = 72;

interface GraphViewportState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

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

function summarizeNodeId(value: string): string {
  return value.length <= 56 ? value : `${value.slice(0, 56)}...`;
}

function extractCreator(node: ProvenanceGraphNode | null): {
  identityId: string;
  fingerprint: string;
  publicKey: string;
} | null {
  if (!node) return null;
  if (!('creator' in node.meta)) return null;
  return node.meta.creator ?? null;
}

function splitIntoLines(value: string, maxChars: number): string[] {
  if (value.length <= maxChars) return [value];

  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }

  if (current) lines.push(current);

  if (lines.length === 1 && lines[0]) {
    return [
      lines[0].slice(0, maxChars),
      `${lines[0].slice(maxChars, maxChars * 2)}...`,
    ];
  }

  if (lines.length > 2) {
    return [lines[0], `${lines[1].slice(0, Math.max(8, maxChars - 3))}...`];
  }

  return lines;
}

function countEdges(
  graph: ProvenanceGraph | null,
  nodeId: string,
  kind: 'includes' | 'supersedes',
): number {
  if (!graph) return 0;
  return graph.edges.filter(
    (edge) => edge.from === nodeId && edge.kind === kind,
  ).length;
}

function toggleCollapsedPack(
  nodeId: string,
  previous: Set<string>,
): Set<string> {
  const next = new Set(previous);
  if (next.has(nodeId)) {
    next.delete(nodeId);
  } else {
    next.add(nodeId);
  }
  return next;
}

function filterCollapsedGraph(
  graph: ProvenanceGraph,
  collapsedPackIds: Set<string>,
): ProvenanceGraph {
  if (collapsedPackIds.size === 0) return graph;

  const edges = graph.edges.filter(
    (edge) => !(edge.kind === 'includes' && collapsedPackIds.has(edge.from)),
  );

  const visibleNodeIds = new Set<string>([graph.metadata.rootNodeId]);
  for (const node of graph.nodes) {
    if (node.kind === 'pack') visibleNodeIds.add(node.id);
  }
  for (const edge of edges) {
    visibleNodeIds.add(edge.from);
    visibleNodeIds.add(edge.to);
  }

  return {
    ...graph,
    nodes: graph.nodes.filter((node) => visibleNodeIds.has(node.id)),
    edges,
  };
}

function clampScale(scale: number): number {
  return Math.max(0.45, Math.min(2.4, scale));
}

function computeFitViewport(
  width: number,
  height: number,
  graphWidth: number,
  graphHeight: number,
): GraphViewportState {
  const scale = clampScale(
    Math.min(
      (width - VIEWPORT_PADDING * 2) / Math.max(graphWidth, 1),
      (height - VIEWPORT_PADDING * 2) / Math.max(graphHeight, 1),
      1,
    ),
  );

  return {
    scale,
    offsetX: (width - graphWidth * scale) / 2,
    offsetY: (height - graphHeight * scale) / 2,
  };
}

export function ProvenancePage() {
  const theme = useTheme();
  const graphViewportRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null>(null);
  const draggedRef = useRef(false);
  const [rawInput, setRawInput] = useState(sampleJson);
  const [selectedNodeId, setSelectedNodeId] = useState('pack:compile-2');
  const [collapsedPackIds, setCollapsedPackIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [viewport, setViewport] = useState<GraphViewportState>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });
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
  const visibleGraph = graph
    ? filterCollapsedGraph(graph, collapsedPackIds)
    : null;
  const selectedNode =
    visibleGraph?.nodes.find((node) => node.id === selectedNodeId) ??
    graph?.nodes.find((node) => node.id === selectedNodeId) ??
    visibleGraph?.nodes[0] ??
    graph?.nodes[0] ??
    null;
  const selectedCreator = extractCreator(selectedNode);
  const layout = visibleGraph ? buildGraphLayout(visibleGraph) : null;

  useEffect(() => {
    if (!graph) {
      setCollapsedPackIds(new Set());
      return;
    }

    const validPackIds = new Set(
      graph.nodes.filter((node) => node.kind === 'pack').map((node) => node.id),
    );
    setCollapsedPackIds((previous) => {
      const next = new Set(
        [...previous].filter((nodeId) => validPackIds.has(nodeId)),
      );
      return next.size === previous.size ? previous : next;
    });
    setSelectedNodeId((previous) => {
      if (graph.nodes.some((node) => node.id === previous)) return previous;
      return graph.metadata.rootNodeId;
    });
  }, [graph]);

  function fitViewport(): void {
    if (!graphViewportRef.current || !layout) return;
    const bounds = graphViewportRef.current.getBoundingClientRect();
    setViewport(
      computeFitViewport(
        bounds.width,
        bounds.height,
        layout.width,
        layout.height,
      ),
    );
  }

  useEffect(() => {
    fitViewport();
  }, [
    layout?.width,
    layout?.height,
    visibleGraph?.nodes.length,
    visibleGraph?.edges.length,
  ]);

  useEffect(() => {
    function handleResize(): void {
      fitViewport();
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  });

  async function handleFileUpload(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;

    setRawInput(await file.text());
    event.target.value = '';
  }

  function handleZoom(delta: number, anchorX: number, anchorY: number): void {
    setViewport((previous) => {
      const nextScale = clampScale(previous.scale * delta);
      const scaleRatio = nextScale / previous.scale;

      return {
        scale: nextScale,
        offsetX: anchorX - (anchorX - previous.offsetX) * scaleRatio,
        offsetY: anchorY - (anchorY - previous.offsetY) * scaleRatio,
      };
    });
  }

  function handleViewportWheel(event: WheelEvent<HTMLDivElement>): void {
    if (!graphViewportRef.current) return;

    event.preventDefault();
    const bounds = graphViewportRef.current.getBoundingClientRect();
    const anchorX = event.clientX - bounds.left;
    const anchorY = event.clientY - bounds.top;
    const multiplier = event.deltaY > 0 ? 0.92 : 1.08;

    handleZoom(multiplier, anchorX, anchorY);
  }

  function handleViewportPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    if (
      event.target instanceof Element &&
      event.target.closest('[data-graph-node="true"]')
    ) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      offsetX: viewport.offsetX,
      offsetY: viewport.offsetY,
      moved: false,
    };
    draggedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleViewportPointerMove(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - dragState.originX;
    const deltaY = event.clientY - dragState.originY;
    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
      dragState.moved = true;
      draggedRef.current = true;
    }

    setViewport({
      scale: viewport.scale,
      offsetX: dragState.offsetX + deltaX,
      offsetY: dragState.offsetY + deltaY,
    });
  }

  function handleViewportPointerUp(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
    }
  }

  function handleNodeClick(node: ProvenanceGraphNode): void {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }

    if (node.kind === 'pack' && selectedNodeId === node.id) {
      setCollapsedPackIds((previous) => toggleCollapsedPack(node.id, previous));
      return;
    }

    setSelectedNodeId(node.id);
  }

  function renderGraph(current: ProvenanceGraph) {
    const currentLayout = buildGraphLayout(current);
    const position = currentLayout.positions;

    return (
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${graphViewportRef.current?.clientWidth ?? currentLayout.width} ${graphViewportRef.current?.clientHeight ?? currentLayout.height}`}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          background:
            'radial-gradient(circle at top left, rgba(230, 168, 23, 0.1), transparent 28%), linear-gradient(180deg, rgba(11, 17, 32, 0.96), rgba(7, 10, 18, 1))',
        }}
      >
        <g
          transform={`translate(${viewport.offsetX} ${viewport.offsetY}) scale(${viewport.scale})`}
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
                  strokeDasharray={
                    edge.kind === 'supersedes' ? '8 6' : undefined
                  }
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
            const collapsed =
              node.kind === 'pack' && collapsedPackIds.has(node.id);
            const labelLines = splitIntoLines(node.label, NODE_LABEL_MAX);
            const creator = extractCreator(node);

            return (
              <g
                key={node.id}
                data-graph-node="true"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => handleNodeClick(node)}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={currentPosition.x}
                  y={currentPosition.y}
                  width={NODE_WIDTH}
                  height={NODE_HEIGHT}
                  rx={24}
                  fill={nodeFill(node.kind)}
                  stroke={nodeStroke(node.kind)}
                  strokeOpacity={selected ? 1 : 0.7}
                  strokeWidth={selected ? 3 : 2}
                />
                {node.kind === 'pack' ? (
                  <>
                    <rect
                      x={currentPosition.x + NODE_WIDTH - 44}
                      y={currentPosition.y + 14}
                      width={28}
                      height={28}
                      rx={14}
                      fill="rgba(255,255,255,0.08)"
                      stroke="rgba(255,255,255,0.18)"
                    />
                    <text
                      x={currentPosition.x + NODE_WIDTH - 30}
                      y={currentPosition.y + 33}
                      fill="#f5f7fb"
                      fontFamily={theme.font.family.mono}
                      fontSize={18}
                      textAnchor="middle"
                    >
                      {collapsed ? '+' : '-'}
                    </text>
                  </>
                ) : null}
                {creator ? (
                  <foreignObject
                    x={currentPosition.x + 16}
                    y={currentPosition.y + 12}
                    width={32}
                    height={32}
                  >
                    <div style={{ width: 32, height: 32 }}>
                      <AgentIdentityMark
                        publicKey={creator.publicKey}
                        size={32}
                      />
                    </div>
                  </foreignObject>
                ) : null}
                {labelLines.map((line, index) => (
                  <text
                    key={`${node.id}-${line}`}
                    x={currentPosition.x + (creator ? 56 : 18)}
                    y={currentPosition.y + 32 + index * 20}
                    fill="#f5f7fb"
                    fontFamily={theme.font.family.sans}
                    fontSize={16}
                    fontWeight={600}
                  >
                    {line}
                  </text>
                ))}
                <text
                  x={currentPosition.x + 18}
                  y={currentPosition.y + 76}
                  fill="rgba(255,255,255,0.72)"
                  fontFamily={theme.font.family.mono}
                  fontSize={12}
                >
                  {node.kind}
                </text>
                <text
                  x={currentPosition.x + 18}
                  y={currentPosition.y + 96}
                  fill="rgba(255,255,255,0.58)"
                  fontFamily={theme.font.family.mono}
                  fontSize={11}
                >
                  {node.cid?.slice(0, 30) ?? 'no cid'}
                </text>
              </g>
            );
          })}
        </g>
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
      <Container maxWidth="xl">
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
              gridTemplateColumns: 'minmax(0, 1.8fr) minmax(320px, 420px)',
              gap: theme.spacing[6],
              alignItems: 'start',
            }}
          >
            <Stack gap={4}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'minmax(0, 2fr) repeat(3, minmax(0, 1fr))',
                  gap: theme.spacing[3],
                }}
              >
                <Card
                  style={{
                    padding: theme.spacing[4],
                    background: 'rgba(9, 14, 27, 0.88)',
                    minWidth: 0,
                  }}
                >
                  <Text variant="overline" color="accent">
                    Root
                  </Text>
                  <Text
                    variant="caption"
                    style={{
                      fontFamily: theme.font.family.mono,
                      overflowWrap: 'anywhere',
                    }}
                  >
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
                  <Text variant="h4">{visibleGraph?.nodes.length ?? 0}</Text>
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
                  <Text variant="h4">{visibleGraph?.edges.length ?? 0}</Text>
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
                  padding: theme.spacing[4],
                  background: 'rgba(9, 14, 27, 0.88)',
                  border: '1px solid rgba(97, 201, 168, 0.18)',
                }}
              >
                <Stack gap={3}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: theme.spacing[3],
                      flexWrap: 'wrap',
                      alignItems: 'center',
                    }}
                  >
                    <Stack gap={1}>
                      <Text variant="h4">Graph Surface</Text>
                      <Text variant="caption" color="secondary">
                        Drag to pan. Use the wheel to zoom. Click a pack once to
                        select it and again to collapse or expand its entry
                        fanout.
                      </Text>
                    </Stack>
                    <div
                      style={{
                        display: 'flex',
                        gap: theme.spacing[2],
                        flexWrap: 'wrap',
                      }}
                    >
                      <Button
                        variant="secondary"
                        onClick={() => {
                          if (!graphViewportRef.current) return;
                          const bounds =
                            graphViewportRef.current.getBoundingClientRect();
                          handleZoom(1.15, bounds.width / 2, bounds.height / 2);
                        }}
                      >
                        Zoom In
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          if (!graphViewportRef.current) return;
                          const bounds =
                            graphViewportRef.current.getBoundingClientRect();
                          handleZoom(0.87, bounds.width / 2, bounds.height / 2);
                        }}
                      >
                        Zoom Out
                      </Button>
                      <Button variant="secondary" onClick={() => fitViewport()}>
                        Fit View
                      </Button>
                    </div>
                  </div>

                  <div
                    ref={graphViewportRef}
                    data-testid="graph-viewport"
                    onWheel={handleViewportWheel}
                    onPointerDown={handleViewportPointerDown}
                    onPointerMove={handleViewportPointerMove}
                    onPointerUp={handleViewportPointerUp}
                    onPointerLeave={handleViewportPointerUp}
                    style={{
                      height: '72vh',
                      minHeight: '40rem',
                      borderRadius: theme.radius.xl,
                      overflow: 'hidden',
                      border: '1px solid rgba(255,255,255,0.08)',
                      touchAction: 'none',
                      cursor:
                        dragStateRef.current !== null ? 'grabbing' : 'grab',
                    }}
                  >
                    {visibleGraph && layout ? renderGraph(visibleGraph) : null}
                  </div>
                </Stack>
              </Card>
            </Stack>

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
                      minHeight: '18rem',
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
                    minWidth: 0,
                  }}
                >
                  <Stack gap={3}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: theme.spacing[2],
                        alignItems: 'start',
                        flexWrap: 'wrap',
                      }}
                    >
                      <Stack gap={2}>
                        <Text variant="h4">Selected Node</Text>
                        <Badge
                          variant={
                            selectedNode.kind === 'pack' ? 'accent' : 'primary'
                          }
                        >
                          {selectedNode.kind}
                        </Badge>
                      </Stack>
                      {selectedNode.kind === 'pack' ? (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            setCollapsedPackIds((previous) =>
                              toggleCollapsedPack(selectedNode.id, previous),
                            )
                          }
                        >
                          {collapsedPackIds.has(selectedNode.id)
                            ? 'Expand Entries'
                            : 'Collapse Entries'}
                        </Button>
                      ) : null}
                    </div>
                    <Text variant="body">{selectedNode.label}</Text>
                    {selectedCreator ? (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: theme.spacing[3],
                          minWidth: 0,
                          flexWrap: 'wrap',
                        }}
                      >
                        <AgentIdentityMark
                          publicKey={selectedCreator.publicKey}
                          size={36}
                        />
                        <KeyFingerprint
                          fingerprint={selectedCreator.fingerprint}
                          size="sm"
                          copyable
                        />
                      </div>
                    ) : null}
                    <Text
                      variant="caption"
                      color="secondary"
                      style={{
                        fontFamily: theme.font.family.mono,
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {selectedNode.id}
                    </Text>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns:
                          'minmax(108px, 136px) minmax(0, 1fr)',
                        gap: theme.spacing[2],
                      }}
                    >
                      <Text variant="caption" color="secondary">
                        visible id
                      </Text>
                      <Text
                        variant="caption"
                        style={{
                          fontFamily: theme.font.family.mono,
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {summarizeNodeId(selectedNode.id)}
                      </Text>
                      <Text variant="caption" color="secondary">
                        includes
                      </Text>
                      <Text variant="caption">
                        {countEdges(graph, selectedNode.id, 'includes')}
                      </Text>
                      <Text variant="caption" color="secondary">
                        supersedes
                      </Text>
                      <Text variant="caption">
                        {countEdges(graph, selectedNode.id, 'supersedes')}
                      </Text>
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
                              overflowWrap: 'anywhere',
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
          </div>
        </Stack>
      </Container>
    </div>
  );
}
