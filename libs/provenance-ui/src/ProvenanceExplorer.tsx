import type { ProvenanceGraph, ProvenanceGraphNode } from '@moltnet/models';
import {
  AgentIdentityMark,
  Badge,
  Button,
  Card,
  KeyFingerprint,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { buildGraphLayout } from './graph-layout.js';
import {
  countEdges,
  extractCreator,
  filterCollapsedGraph,
  hasHiddenAncestor,
  summarizeNodeId,
  summarizeValue,
  toggleCollapsedPack,
} from './graph-utils.js';
import {
  clampScale,
  computeFitViewport,
  type GraphViewportState,
} from './graph-viewport.js';
import { ProvenanceGraphSurface } from './ProvenanceGraphSurface.js';

export interface ProvenanceExplorerProps {
  graph: ProvenanceGraph;
  height?: number | string;
  renderNodeActions?: (node: ProvenanceGraphNode) => ReactNode;
}

function badgeVariant(
  kind: ProvenanceGraphNode['kind'],
): 'accent' | 'primary' | 'info' {
  if (kind === 'pack') return 'accent';
  if (kind === 'rendered_pack') return 'info';
  return 'primary';
}

export function ProvenanceExplorer({
  graph,
  height = '36rem',
  renderNodeActions,
}: ProvenanceExplorerProps) {
  const theme = useTheme();
  const graphViewportRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<ReturnType<typeof buildGraphLayout> | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const draggedRef = useRef(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    graph.metadata.rootNodeId,
  );
  const [collapsedPackIds, setCollapsedPackIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isDragging, setIsDragging] = useState(false);
  const [viewport, setViewport] = useState<GraphViewportState>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });

  const visibleGraph = useMemo(
    () => filterCollapsedGraph(graph, collapsedPackIds),
    [graph, collapsedPackIds],
  );
  const selectedNode =
    visibleGraph.nodes.find((node) => node.id === selectedNodeId) ??
    graph.nodes.find((node) => node.id === selectedNodeId) ??
    graph.nodes.find((node) => node.id === graph.metadata.rootNodeId) ??
    graph.nodes[0] ??
    null;
  const selectedCreator = extractCreator(selectedNode);
  const layout = useMemo(() => buildGraphLayout(visibleGraph), [visibleGraph]);
  layoutRef.current = layout;

  useEffect(() => {
    const validPackIds = new Set(
      graph.nodes.filter((node) => node.kind === 'pack').map((node) => node.id),
    );
    setCollapsedPackIds((previous) => {
      const next = new Set(
        [...previous].filter((nodeId) => validPackIds.has(nodeId)),
      );
      return next.size === previous.size ? previous : next;
    });
    setSelectedNodeId((previous) =>
      previous && graph.nodes.some((node) => node.id === previous)
        ? previous
        : graph.metadata.rootNodeId,
    );
  }, [graph]);

  const fitViewport = useCallback(() => {
    const currentLayout = layoutRef.current;
    if (!graphViewportRef.current || !currentLayout) return;
    const bounds = graphViewportRef.current.getBoundingClientRect();
    setViewport(
      computeFitViewport(
        bounds.width,
        bounds.height,
        currentLayout.width,
        currentLayout.height,
      ),
    );
  }, []);

  useEffect(() => {
    fitViewport();
  }, [
    fitViewport,
    layout.width,
    layout.height,
    visibleGraph.nodes.length,
    visibleGraph.edges.length,
  ]);

  useEffect(() => {
    window.addEventListener('resize', fitViewport);
    return () => window.removeEventListener('resize', fitViewport);
  }, [fitViewport]);

  useEffect(() => {
    const element = graphViewportRef.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      const anchorX = event.clientX - bounds.left;
      const anchorY = event.clientY - bounds.top;
      const multiplier = event.deltaY > 0 ? 0.92 : 1.08;
      setViewport((previous) => {
        const nextScale = clampScale(previous.scale * multiplier);
        const scaleRatio = nextScale / previous.scale;
        return {
          scale: nextScale,
          offsetX: anchorX - (anchorX - previous.offsetX) * scaleRatio,
          offsetY: anchorY - (anchorY - previous.offsetY) * scaleRatio,
        };
      });
    };
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, []);

  function zoom(multiplier: number): void {
    const bounds = graphViewportRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const anchorX = bounds.width / 2;
    const anchorY = bounds.height / 2;
    setViewport((previous) => {
      const nextScale = clampScale(previous.scale * multiplier);
      const scaleRatio = nextScale / previous.scale;
      return {
        scale: nextScale,
        offsetX: anchorX - (anchorX - previous.offsetX) * scaleRatio,
        offsetY: anchorY - (anchorY - previous.offsetY) * scaleRatio,
      };
    });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
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
    };
    draggedRef.current = false;
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragState.originX;
    const deltaY = event.clientY - dragState.originY;
    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) draggedRef.current = true;
    setViewport((previous) => ({
      scale: previous.scale,
      offsetX: dragState.offsetX + deltaX,
      offsetY: dragState.offsetY + deltaY,
    }));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
    }
    setIsDragging(false);
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

  return (
    <Stack gap={4}>
      <div
        aria-label="Graph summary"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) repeat(3, minmax(5rem, 1fr))',
          gap: theme.spacing[3],
          paddingBottom: theme.spacing[3],
          borderBottom: `1px solid ${theme.color.border.DEFAULT}`,
        }}
      >
        <Stack gap={1} style={{ minWidth: 0 }}>
          <Text variant="caption" color="muted">
            Root
          </Text>
          <Text
            variant="caption"
            style={{
              fontFamily: theme.font.family.mono,
              overflowWrap: 'anywhere',
            }}
          >
            {graph.metadata.rootNodeId}
          </Text>
        </Stack>
        <Stack gap={1}>
          <Text variant="caption" color="muted">
            Nodes
          </Text>
          <Text weight="semibold">{visibleGraph.nodes.length}</Text>
        </Stack>
        <Stack gap={1}>
          <Text variant="caption" color="muted">
            Edges
          </Text>
          <Text weight="semibold">{visibleGraph.edges.length}</Text>
        </Stack>
        <Stack gap={1}>
          <Text variant="caption" color="muted">
            Depth
          </Text>
          <Text weight="semibold">{graph.metadata.depth}</Text>
        </Stack>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(100%, 22rem), 1fr))',
          gap: theme.spacing[4],
          alignItems: 'start',
        }}
      >
        <Card variant="outlined" padding="md">
          <Stack gap={3}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: theme.spacing[3],
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <Stack gap={1}>
                <Text weight="semibold">Provenance graph</Text>
                <Text variant="caption" color="muted">
                  Drag to pan, use the wheel to zoom, and select a pack twice to
                  collapse its entries.
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
                  size="sm"
                  onClick={() => zoom(1.15)}
                >
                  Zoom in
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => zoom(0.87)}
                >
                  Zoom out
                </Button>
                <Button variant="secondary" size="sm" onClick={fitViewport}>
                  Fit view
                </Button>
              </div>
            </div>

            <div
              ref={graphViewportRef}
              data-testid="graph-viewport"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{
                height,
                minHeight: '24rem',
                borderRadius: theme.radius.lg,
                overflow: 'hidden',
                border: `1px solid ${theme.color.border.DEFAULT}`,
                touchAction: 'none',
                cursor: isDragging ? 'grabbing' : 'grab',
              }}
            >
              <ProvenanceGraphSurface
                collapsedPackIds={collapsedPackIds}
                containerHeight={
                  graphViewportRef.current?.clientHeight ?? layout.height
                }
                containerWidth={
                  graphViewportRef.current?.clientWidth ?? layout.width
                }
                graph={visibleGraph}
                layout={layout}
                onNodeClick={handleNodeClick}
                selectedNodeId={selectedNode?.id ?? null}
                viewport={viewport}
              />
            </div>

            <details>
              <summary
                style={{ cursor: 'pointer', color: theme.color.text.secondary }}
              >
                Accessible graph outline
              </summary>
              <Stack gap={3} style={{ paddingTop: theme.spacing[3] }}>
                <ul style={{ margin: 0, paddingInlineStart: theme.spacing[5] }}>
                  {visibleGraph.nodes.map((node) => (
                    <li key={node.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedNodeId(node.id)}
                        style={{
                          border: 0,
                          padding: `${theme.spacing[1]} 0`,
                          background: 'transparent',
                          color: theme.color.text.DEFAULT,
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                      >
                        {node.label} ({node.kind})
                      </button>
                    </li>
                  ))}
                </ul>
                <Text variant="caption" color="muted">
                  {visibleGraph.edges
                    .map((edge) => `${edge.from} ${edge.kind} ${edge.to}`)
                    .join('; ') || 'No relationships'}
                </Text>
              </Stack>
            </details>
          </Stack>
        </Card>

        {selectedNode ? (
          <Card variant="outlined" padding="md">
            <Stack gap={3}>
              <Stack direction="row" gap={2} align="center" wrap>
                <Text weight="semibold">Selected node</Text>
                <Badge variant={badgeVariant(selectedNode.kind)}>
                  {selectedNode.kind}
                </Badge>
              </Stack>
              <Text>{selectedNode.label}</Text>
              {selectedCreator?.kind === 'agent' ? (
                <Stack direction="row" gap={3} align="center" wrap>
                  <AgentIdentityMark
                    publicKey={selectedCreator.publicKey}
                    size={36}
                  />
                  <KeyFingerprint
                    fingerprint={selectedCreator.fingerprint}
                    size="sm"
                    copyable
                  />
                </Stack>
              ) : null}
              <Text
                variant="caption"
                color="muted"
                style={{
                  fontFamily: theme.font.family.mono,
                  overflowWrap: 'anywhere',
                }}
              >
                {selectedNode.id}
              </Text>
              {hasHiddenAncestor(graph, selectedNode) ? (
                <Text variant="caption" color="muted">
                  This pack replaced an earlier one that is not shown, either
                  beyond the requested depth or outside your readable diaries.
                </Text>
              ) : null}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(7rem, 9rem) minmax(0, 1fr)',
                  gap: theme.spacing[2],
                }}
              >
                <Text variant="caption" color="muted">
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
                <Text variant="caption" color="muted">
                  includes
                </Text>
                <Text variant="caption">
                  {countEdges(graph, selectedNode.id, 'includes')}
                </Text>
                <Text variant="caption" color="muted">
                  supersedes
                </Text>
                <Text variant="caption">
                  {countEdges(graph, selectedNode.id, 'supersedes')}
                </Text>
                {Object.entries(selectedNode.meta).map(([key, value]) => (
                  <Fragment key={key}>
                    <Text variant="caption" color="muted">
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
              {selectedNode.kind === 'pack' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setCollapsedPackIds((previous) =>
                      toggleCollapsedPack(selectedNode.id, previous),
                    )
                  }
                >
                  {collapsedPackIds.has(selectedNode.id)
                    ? 'Expand entries'
                    : 'Collapse entries'}
                </Button>
              ) : null}
              {renderNodeActions?.(selectedNode)}
            </Stack>
          </Card>
        ) : null}
      </div>
    </Stack>
  );
}
