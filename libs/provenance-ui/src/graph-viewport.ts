export interface GraphViewportState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const VIEWPORT_PADDING = 48;
const MIN_FIT_SCALE = 0.16;

export function clampScale(scale: number): number {
  return Math.max(0.45, Math.min(2.4, scale));
}

export function computeFitViewport(
  width: number,
  height: number,
  graphWidth: number,
  graphHeight: number,
): GraphViewportState {
  const padding = Math.min(VIEWPORT_PADDING, width * 0.08, height * 0.08);
  const scale = Math.max(
    MIN_FIT_SCALE,
    Math.min(
      (width - padding * 2) / Math.max(graphWidth, 1),
      (height - padding * 2) / Math.max(graphHeight, 1),
      1,
    ),
  );

  return {
    scale,
    offsetX: (width - graphWidth * scale) / 2,
    offsetY: (height - graphHeight * scale) / 2,
  };
}
