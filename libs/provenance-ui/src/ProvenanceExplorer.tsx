import type { ProvenanceGraph, ProvenanceGraphNode } from '@moltnet/models';
import {
  AgentIdentityMark,
  Badge,
  Button,
  Card,
  DescriptionList,
  KeyFingerprint,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  useCallback,
  useEffect,
  useId,
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
): 'default' | 'primary' | 'info' {
  if (kind === 'pack') return 'default';
  if (kind === 'rendered_pack') return 'info';
  return 'primary';
}

export function ProvenanceExplorer({
  graph,
  height = '36rem',
  renderNodeActions,
}: ProvenanceExplorerProps) {
  const theme = useTheme();
  const graphViewportId = useId();
  const graphViewportRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<ReturnType<typeof buildGraphLayout> | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
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
  const isNarrow = containerSize.width > 0 && containerSize.width < 640;

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
  const layout = useMemo(
    () => buildGraphLayout(visibleGraph, isNarrow ? 'vertical' : 'horizontal'),
    [isNarrow, visibleGraph],
  );
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
    const element = graphViewportRef.current;
    if (!element) return;

    const updateSize = () => {
      const bounds = element.getBoundingClientRect();
      setContainerSize({ width: bounds.width, height: bounds.height });
    };

    updateSize();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (containerSize.width > 0 && containerSize.height > 0) fitViewport();
  }, [containerSize.height, containerSize.width, fitViewport]);

  useEffect(() => {
    const element = graphViewportRef.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
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
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragState.originX;
    const deltaY = event.clientY - dragState.originY;
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
    setSelectedNodeId(node.id);
  }

  const selectedMetadata = selectedNode
    ? Object.entries(selectedNode.meta)
        .filter(([key]) => key !== 'creator')
        .map(([key, value]) => ({
          label: key,
          value: summarizeValue(value),
          mono: typeof value === 'string' && value.length > 18,
        }))
    : [];

  const selectedProof = selectedNode
    ? [
        {
          label: 'Visible ID',
          value: summarizeNodeId(selectedNode.id),
          mono: true,
        },
        {
          label: 'Content address',
          value: selectedNode.cid ?? 'Not recorded',
          mono: true,
        },
        {
          label: 'Included evidence',
          value: countEdges(graph, selectedNode.id, 'includes'),
        },
        {
          label: 'Superseded packs',
          value: countEdges(graph, selectedNode.id, 'supersedes'),
        },
      ]
    : [];
  const selectedIncludedEvidenceCount = selectedNode
    ? countEdges(graph, selectedNode.id, 'includes')
    : 0;

  return (
    <Stack gap={4}>
      <div
        style={{
          paddingBottom: theme.spacing[3],
          borderBottom: `1px solid ${theme.color.border.DEFAULT}`,
        }}
      >
        <DescriptionList
          ariaLabel="Graph summary"
          columns={4}
          compact
          items={[
            { label: 'Root', value: graph.metadata.rootNodeId, mono: true },
            { label: 'Visible nodes', value: visibleGraph.nodes.length },
            { label: 'Relationships', value: visibleGraph.edges.length },
            { label: 'Requested depth', value: graph.metadata.depth },
          ]}
        />
      </div>

      <div role="status" aria-live="polite" aria-atomic="true">
        <Text variant="caption" color="muted">
          Showing {visibleGraph.nodes.length} of {graph.nodes.length} nodes and{' '}
          {visibleGraph.edges.length} relationships.
        </Text>
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
                <Text variant="h3">Provenance graph</Text>
                <Text variant="caption" color="muted">
                  Select a node to inspect its proof. Drag empty space to pan;
                  use Ctrl/⌘ + wheel or the controls to zoom.
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
              aria-label="Graph legend"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: theme.spacing[2],
                flexWrap: 'wrap',
              }}
            >
              <Badge variant="default">Pack</Badge>
              <Badge variant="primary">Entry</Badge>
              <Badge variant="info">Rendered pack</Badge>
              <Text variant="caption" color="muted" mono>
                → includes · ⇢ supersedes · ⋯ rendered from
              </Text>
            </div>

            <div
              id={graphViewportId}
              ref={graphViewportRef}
              data-testid="graph-viewport"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{
                height: isNarrow ? '32rem' : height,
                minHeight: isNarrow ? '28rem' : '24rem',
                borderRadius: theme.radius.lg,
                overflow: 'hidden',
                border: `1px solid ${theme.color.border.DEFAULT}`,
                touchAction: 'pan-y',
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
                style={{
                  cursor: 'pointer',
                  color: theme.color.text.secondary,
                  minHeight: 44,
                  paddingBlock: theme.spacing[2],
                  boxSizing: 'border-box',
                }}
              >
                Accessible graph outline
              </summary>
              <Stack gap={3} style={{ paddingTop: theme.spacing[3] }}>
                <ul style={{ margin: 0, paddingInlineStart: theme.spacing[5] }}>
                  {visibleGraph.nodes.map((node) => (
                    <li key={node.id}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedNodeId(node.id)}
                        style={{
                          width: '100%',
                          justifyContent: 'flex-start',
                          textAlign: 'left',
                        }}
                      >
                        {node.label} ({node.kind})
                      </Button>
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
                <Text variant="h3">Evidence details</Text>
                <Badge variant={badgeVariant(selectedNode.kind)}>
                  {selectedNode.kind.replace('_', ' ')}
                </Badge>
              </Stack>
              <Text variant="h4">{selectedNode.label}</Text>
              <span
                aria-live="polite"
                style={{
                  position: 'absolute',
                  width: 1,
                  height: 1,
                  padding: 0,
                  margin: -1,
                  overflow: 'hidden',
                  clip: 'rect(0, 0, 0, 0)',
                  whiteSpace: 'nowrap',
                  border: 0,
                }}
              >
                Selected {selectedNode.kind} {selectedNode.label}
              </span>
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
              <DescriptionList
                ariaLabel="Selected evidence summary"
                columns={2}
                compact
                items={selectedProof}
              />
              {hasHiddenAncestor(graph, selectedNode) ? (
                <Text variant="caption" color="muted">
                  This pack replaced an earlier one that is not shown, either
                  beyond the requested depth or outside your readable diaries.
                </Text>
              ) : null}
              <details>
                <summary
                  style={{
                    cursor: 'pointer',
                    color: theme.color.text.secondary,
                    minHeight: 44,
                    paddingBlock: theme.spacing[2],
                    boxSizing: 'border-box',
                  }}
                >
                  Technical metadata
                </summary>
                <div style={{ paddingTop: theme.spacing[3] }}>
                  <DescriptionList
                    ariaLabel="Technical metadata"
                    columns={1}
                    compact
                    items={selectedMetadata}
                  />
                </div>
              </details>
              {selectedNode.kind === 'pack' &&
              selectedIncludedEvidenceCount > 0 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  aria-expanded={!collapsedPackIds.has(selectedNode.id)}
                  aria-controls={graphViewportId}
                  onClick={() =>
                    setCollapsedPackIds((previous) =>
                      toggleCollapsedPack(selectedNode.id, previous),
                    )
                  }
                >
                  {collapsedPackIds.has(selectedNode.id)
                    ? `Show ${selectedIncludedEvidenceCount} included entries`
                    : `Hide ${selectedIncludedEvidenceCount} included entries`}
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
