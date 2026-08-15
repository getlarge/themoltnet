import type { ProvenanceGraph, ProvenanceGraphNode } from '@moltnet/models';
import { AgentIdentityMark, useTheme } from '@themoltnet/design-system';
import type { KeyboardEvent } from 'react';
import { useId, useState } from 'react';

import {
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  type GraphLayout,
} from './graph-layout.js';
import { extractCreator, splitIntoLines } from './graph-utils.js';
import type { GraphViewportState } from './graph-viewport.js';

const NODE_LABEL_MAX = 28;
const LABEL_X_WITH_AVATAR = 56;
const LABEL_X_NO_AVATAR = 18;
const LABEL_MAX_WIDTH_WITH_AVATAR = GRAPH_NODE_WIDTH - LABEL_X_WITH_AVATAR - 14;
const LABEL_MAX_WIDTH_NO_AVATAR = GRAPH_NODE_WIDTH - LABEL_X_NO_AVATAR - 14;

type NodeKind = ProvenanceGraphNode['kind'];
type EdgeKind = 'includes' | 'supersedes' | 'rendered_from';
type ThemeColors = ReturnType<typeof useTheme>['color'];

const nodeColorScale: Record<NodeKind, (colors: ThemeColors) => string> = {
  pack: (colors) => colors.bg.overlay,
  entry: (colors) => colors.primary.muted,
  rendered_pack: (colors) => colors.info.muted,
};

const nodeStrokeScale: Record<NodeKind, (colors: ThemeColors) => string> = {
  pack: (colors) => colors.border.hover,
  entry: (colors) => colors.primary.DEFAULT,
  rendered_pack: (colors) => colors.info.DEFAULT,
};

const edgeColorScale: Record<EdgeKind, (colors: ThemeColors) => string> = {
  includes: (colors) => colors.primary.DEFAULT,
  supersedes: (colors) => colors.text.secondary,
  rendered_from: (colors) => colors.info.DEFAULT,
};

const edgeDash: Record<EdgeKind, string | undefined> = {
  includes: undefined,
  supersedes: '8 6',
  rendered_from: '4 4',
};

export interface ProvenanceGraphSurfaceProps {
  collapsedPackIds: Set<string>;
  containerHeight: number;
  containerWidth: number;
  graph: ProvenanceGraph;
  layout: GraphLayout;
  onNodeClick: (node: ProvenanceGraphNode) => void;
  selectedNodeId: string | null;
  viewport: GraphViewportState;
}

export function ProvenanceGraphSurface({
  collapsedPackIds,
  containerHeight,
  containerWidth,
  graph,
  layout,
  onNodeClick,
  selectedNodeId,
  viewport,
}: ProvenanceGraphSurfaceProps) {
  const theme = useTheme();
  const idPrefix = useId().replaceAll(':', '');
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const activateNode = (
    event: KeyboardEvent<SVGGElement>,
    node: ProvenanceGraphNode,
  ) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onNodeClick(node);
  };

  return (
    <svg
      role="group"
      aria-label={`${graph.nodes.length} provenance nodes and ${graph.edges.length} relationships`}
      width="100%"
      height="100%"
      viewBox={`0 0 ${containerWidth || layout.width} ${containerHeight || layout.height}`}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        background: `linear-gradient(180deg, ${theme.color.bg.elevated}, ${theme.color.bg.void})`,
      }}
    >
      <defs>
        {(Object.keys(edgeColorScale) as EdgeKind[]).map((kind) => (
          <marker
            key={kind}
            id={`${idPrefix}-${kind}-arrow`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path
              d="M 0 0 L 10 5 L 0 10 z"
              fill={edgeColorScale[kind](theme.color)}
            />
          </marker>
        ))}
      </defs>
      <g
        transform={`translate(${viewport.offsetX} ${viewport.offsetY}) scale(${viewport.scale})`}
      >
        {graph.edges.map((edge) => {
          const from = layout.positions[edge.from];
          const to = layout.positions[edge.to];
          if (!from || !to) return null;
          const vertical = layout.orientation === 'vertical';
          const x1 = vertical
            ? from.x + GRAPH_NODE_WIDTH / 2
            : from.x + GRAPH_NODE_WIDTH;
          const y1 = vertical
            ? from.y + GRAPH_NODE_HEIGHT
            : from.y + GRAPH_NODE_HEIGHT / 2;
          const x2 = vertical ? to.x + GRAPH_NODE_WIDTH / 2 : to.x;
          const y2 = vertical ? to.y : to.y + GRAPH_NODE_HEIGHT / 2;
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          const path = vertical
            ? `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
            : `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;

          return (
            <g key={edge.id}>
              <path
                d={path}
                fill="none"
                stroke={edgeColorScale[edge.kind](theme.color)}
                strokeDasharray={edgeDash[edge.kind]}
                strokeOpacity={0.8}
                strokeWidth={2.5}
                markerEnd={`url(#${idPrefix}-${edge.kind}-arrow)`}
              />
              {edge.label ? (
                <text
                  x={vertical ? midX + 12 : midX}
                  y={vertical ? midY : midY - 8}
                  fill={theme.color.text.secondary}
                  fontFamily={theme.font.family.mono}
                  fontSize={12}
                  textAnchor={vertical ? 'start' : 'middle'}
                >
                  {edge.label}
                </text>
              ) : null}
            </g>
          );
        })}

        {graph.nodes.map((node, index) => {
          const position = layout.positions[node.id];
          if (!position) return null;
          const selected = node.id === selectedNodeId;
          const collapsed =
            node.kind === 'pack' && collapsedPackIds.has(node.id);
          const creator = extractCreator(node);
          const labelLines = splitIntoLines(node.label, NODE_LABEL_MAX);
          const focused = node.id === focusedNodeId;
          const clipId = `${idPrefix}-clip-${index}`;

          return (
            <g
              key={node.id}
              data-graph-node="true"
              role="button"
              tabIndex={0}
              aria-label={`${node.kind} node: ${node.label}${collapsed ? ', included entries hidden' : ''}`}
              aria-pressed={selected}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onNodeClick(node)}
              onKeyDown={(event) => activateNode(event, node)}
              onFocus={() => setFocusedNodeId(node.id)}
              onBlur={() => setFocusedNodeId(null)}
              style={{ cursor: 'pointer' }}
            >
              {focused ? (
                <rect
                  x={position.x - 5}
                  y={position.y - 5}
                  width={GRAPH_NODE_WIDTH + 10}
                  height={GRAPH_NODE_HEIGHT + 10}
                  rx={20}
                  fill="none"
                  stroke={theme.color.border.focus}
                  strokeWidth={3}
                />
              ) : null}
              <rect
                x={position.x}
                y={position.y}
                width={GRAPH_NODE_WIDTH}
                height={GRAPH_NODE_HEIGHT}
                rx={16}
                fill={nodeColorScale[node.kind](theme.color)}
                stroke={
                  selected
                    ? theme.color.primary.DEFAULT
                    : nodeStrokeScale[node.kind](theme.color)
                }
                strokeOpacity={selected ? 1 : 0.7}
                strokeWidth={selected ? 3 : 2}
              />
              {creator?.kind === 'agent' ? (
                <foreignObject
                  x={position.x + 16}
                  y={position.y + 12}
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
              <clipPath id={clipId}>
                <rect
                  x={
                    position.x +
                    (creator ? LABEL_X_WITH_AVATAR : LABEL_X_NO_AVATAR)
                  }
                  y={position.y + 8}
                  width={
                    creator
                      ? LABEL_MAX_WIDTH_WITH_AVATAR
                      : LABEL_MAX_WIDTH_NO_AVATAR
                  }
                  height={52}
                />
              </clipPath>
              <g clipPath={`url(#${clipId})`}>
                {labelLines.map((line, index) => (
                  <text
                    key={`${node.id}-${index}`}
                    x={
                      position.x +
                      (creator ? LABEL_X_WITH_AVATAR : LABEL_X_NO_AVATAR)
                    }
                    y={position.y + 32 + index * 20}
                    fill={theme.color.text.DEFAULT}
                    fontFamily={theme.font.family.sans}
                    fontSize={15}
                    fontWeight={600}
                  >
                    {line}
                  </text>
                ))}
              </g>
              <text
                x={position.x + 18}
                y={position.y + 76}
                fill={theme.color.text.secondary}
                fontFamily={theme.font.family.mono}
                fontSize={12}
              >
                {node.kind}
                {node.kind === 'pack' ? ` · ${node.meta.packType}` : ''}
                {collapsed ? ' · entries hidden' : ''}
              </text>
              <text
                x={position.x + 18}
                y={position.y + 96}
                fill={theme.color.text.muted}
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
