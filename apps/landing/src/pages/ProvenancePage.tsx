import type { ProvenanceGraphNode } from '@moltnet/models';
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
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  Fragment,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'wouter';

import { buildGraphLayout } from '../provenance/graph-layout';
import {
  compressGraphToParam,
  decompressGraphFromParam,
} from '../provenance/graph-sharing';
import {
  clampScale,
  computeFitViewport,
  type GraphViewportState,
} from '../provenance/graph-viewport';
import { parseProvenanceGraph } from '../provenance/parse-graph';
import { ProvenanceGraphSurface } from '../provenance/ProvenanceGraphSurface';
import {
  countEdges,
  extractCreator,
  filterCollapsedGraph,
  summarizeNodeId,
  summarizeValue,
  toggleCollapsedPack,
} from '../provenance/viewer-utils';

export function ProvenancePage() {
  const theme = useTheme();
  const graphViewportRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<ReturnType<typeof buildGraphLayout> | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null>(null);
  const draggedRef = useRef(false);
  const [rawInput, setRawInput] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [collapsedPackIds, setCollapsedPackIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isDragging, setIsDragging] = useState(false);
  const [viewport, setViewport] = useState<GraphViewportState>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });
  const deferredInput = useDeferredValue(rawInput);

  // Load graph from ?graph= URL parameter on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const graphParam = params.get('graph');
    if (!graphParam) return;

    decompressGraphFromParam(graphParam)
      .then((json) => setRawInput(json))
      .catch((err) => {
        // Fallback: try plain base64url (no compression)
        try {
          const base64 = graphParam.replace(/-/g, '+').replace(/_/g, '/');
          const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
          const json = atob(padded);
          if (json.startsWith('{')) {
            setRawInput(json);
            return;
          }
        } catch {
          // not base64 either
        }
        // eslint-disable-next-line no-console
        console.error('[provenance] failed to decode ?graph= param:', err);
      });
  }, []);

  // Pre-compute the shareable URL so the click handler stays synchronous
  // (Safari drops clipboard access if there's an async gap after the gesture)
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!rawInput.trim()) {
      setShareUrl(null);
      return;
    }
    let cancelled = false;
    void compressGraphToParam(rawInput).then((param) => {
      if (cancelled) return;
      if (!param) {
        setShareUrl(null);
        return;
      }
      const url = new URL(window.location.href);
      url.search = `?graph=${param}`;
      setShareUrl(url.toString());
    });
    return () => {
      cancelled = true;
    };
  }, [rawInput]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopyLink = useCallback(() => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(
      () => {
        setLinkCopied(true);
        copyTimerRef.current = setTimeout(() => setLinkCopied(false), 2000);
      },
      () => {
        // Fallback for restrictive browsers
        const textarea = document.createElement('textarea');
        textarea.value = shareUrl;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setLinkCopied(true);
        copyTimerRef.current = setTimeout(() => setLinkCopied(false), 2000);
      },
    );
  }, [shareUrl]);

  const parsed = useMemo(() => {
    if (deferredInput.trim() === '') {
      return { graph: null, error: null as string | null };
    }

    try {
      const graph = parseProvenanceGraph(deferredInput);
      return { graph, error: null as string | null };
    } catch (error) {
      return {
        graph: null,
        error: error instanceof Error ? error.message : 'Failed to parse graph',
      };
    }
  }, [deferredInput]);

  const graph = parsed.graph;
  const visibleGraph = useMemo(
    () => (graph ? filterCollapsedGraph(graph, collapsedPackIds) : null),
    [graph, collapsedPackIds],
  );
  const selectedNode =
    visibleGraph?.nodes.find((node) => node.id === selectedNodeId) ??
    graph?.nodes.find((node) => node.id === selectedNodeId) ??
    visibleGraph?.nodes[0] ??
    graph?.nodes[0] ??
    null;
  const selectedCreator = extractCreator(selectedNode);
  const layout = useMemo(
    () => (visibleGraph ? buildGraphLayout(visibleGraph) : null),
    [visibleGraph],
  );
  layoutRef.current = layout;

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
      if (previous && graph.nodes.some((node) => node.id === previous)) {
        return previous;
      }
      return graph.metadata.rootNodeId;
    });
  }, [graph]);

  function fitViewport(): void {
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
  }, []);

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

  useEffect(() => {
    const element = graphViewportRef.current;
    if (!element) return;
    const viewportElement = element;

    function handleNativeWheel(event: globalThis.WheelEvent): void {
      event.preventDefault();
      const bounds = viewportElement.getBoundingClientRect();
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
    }

    viewportElement.addEventListener('wheel', handleNativeWheel, {
      passive: false,
    });
    return () => {
      viewportElement.removeEventListener('wheel', handleNativeWheel);
    };
  }, []);

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
    setIsDragging(true);
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

    setViewport((previous) => ({
      scale: previous.scale,
      offsetX: dragState.offsetX + deltaX,
      offsetY: dragState.offsetY + deltaY,
    }));
  }

  function handleViewportPointerUp(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
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
    <div
      style={{
        paddingTop: '5rem',
        minHeight: '100vh',
        background: `linear-gradient(180deg, ${theme.color.bg.elevated} 0%, ${theme.color.bg.surface} 52%, ${theme.color.bg.void} 100%)`,
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
                    background: theme.color.bg.elevated,
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
                    background: theme.color.bg.elevated,
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
                    background: theme.color.bg.elevated,
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
                    background: theme.color.bg.elevated,
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
                  background: theme.color.bg.elevated,
                  border: `1px solid ${theme.color.primary.muted}`,
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
                    onPointerDown={handleViewportPointerDown}
                    onPointerMove={handleViewportPointerMove}
                    onPointerUp={handleViewportPointerUp}
                    onPointerLeave={handleViewportPointerUp}
                    onPointerCancel={handleViewportPointerUp}
                    style={{
                      height: '72vh',
                      minHeight: '40rem',
                      borderRadius: theme.radius.xl,
                      overflow: 'hidden',
                      border: `1px solid ${theme.color.border.DEFAULT}`,
                      touchAction: 'none',
                      cursor: isDragging ? 'grabbing' : 'grab',
                    }}
                  >
                    {visibleGraph && layout ? (
                      <ProvenanceGraphSurface
                        collapsedPackIds={collapsedPackIds}
                        containerHeight={
                          graphViewportRef.current?.clientHeight ??
                          layout.height
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
                    ) : null}
                  </div>
                </Stack>
              </Card>
            </Stack>

            <Stack gap={4}>
              <Card
                style={{
                  padding: theme.spacing[5],
                  background: theme.color.bg.elevated,
                  border: `1px solid ${theme.color.accent.muted}`,
                }}
              >
                <Stack gap={3}>
                  <Text variant="h4">Graph Input</Text>
                  <Text variant="caption" color="secondary">
                    Paste a `moltnet.provenance-graph/v1` payload or export a
                    real pack graph with `npx @themoltnet/cli pack provenance`.
                  </Text>
                  <div
                    style={{
                      display: 'flex',
                      gap: theme.spacing[2],
                      flexWrap: 'wrap',
                    }}
                  >
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
                    {shareUrl ? (
                      <Button variant="secondary" onClick={handleCopyLink}>
                        {linkCopied ? 'Copied!' : 'Copy Link'}
                      </Button>
                    ) : null}
                  </div>
                  <textarea
                    value={rawInput}
                    onChange={(event) => setRawInput(event.target.value)}
                    spellCheck={false}
                    placeholder={`{\n  "metadata": { ... },\n  "nodes": [],\n  "edges": []\n}`}
                    style={{
                      minHeight: '18rem',
                      width: '100%',
                      resize: 'vertical',
                      borderRadius: theme.radius.lg,
                      border: `1px solid ${theme.color.border.DEFAULT}`,
                      background: theme.color.bg.void,
                      color: theme.color.text.DEFAULT,
                      padding: theme.spacing[4],
                      fontFamily: theme.font.family.mono,
                      fontSize: theme.font.size.xs,
                    }}
                  />
                  {parsed.error ? (
                    <Text
                      variant="caption"
                      style={{ color: theme.color.error.DEFAULT }}
                    >
                      {parsed.error}
                    </Text>
                  ) : null}
                </Stack>
              </Card>

              {selectedNode ? (
                <Card
                  style={{
                    padding: theme.spacing[5],
                    background: theme.color.bg.elevated,
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
