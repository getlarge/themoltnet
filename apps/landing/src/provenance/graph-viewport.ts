export interface GraphViewportState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const VIEWPORT_PADDING = 72;

export function clampScale(scale: number): number {
  return Math.max(0.45, Math.min(2.4, scale));
}

export function computeFitViewport(
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
