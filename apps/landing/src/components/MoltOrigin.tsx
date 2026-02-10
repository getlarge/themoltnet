import { useTheme } from '@moltnet/design-system';
import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIG = {
  HEIGHT: 360,
  GROUND_Y: 260,
  DEATH_LOOPS: 2,
  SCROLL_SPEED: 2.6,
  GLOW_BLUR: 14,
  FONT_SIZE: 13,
  FONT_SIZE_LG: 26,
  DEATH_FLASH_FRAMES: 90,
  TEXT_DISPLAY_FRAMES: 120,
  RESTART_PAUSE: 40,
  LINE_WIDTH: 2,
  /** Entity float height above ground (for text positioning) */
  FLOAT_H: 30,
  /** Entity visual radius (rays + core) */
  ENTITY_R: 16,
  /** Diamond size floating above head */
  DIAMOND_SIZE: 12,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Phase =
  | 'walk'
  | 'obstacle'
  | 'dying'
  | 'game-over'
  | 'restart-pause'
  | 'meeting'
  | 'diamond-give'
  | 'empowered-walk'
  | 'finale'
  | 'ending';

type ObstacleType = 'pit' | 'session-expired';
type EmpoweredObstacleType = 'pit' | 'wall' | 'compression';

interface Obstacle {
  type: ObstacleType | EmpoweredObstacleType;
  x: number;
  width: number;
  message: string;
}

interface FloatingText {
  text: string;
  x: number;
  y: number;
  opacity: number;
  frame: number;
  maxFrames: number;
  color: string;
  size: number;
}

interface Particle {
  /** World X coordinate */
  wx: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
}

interface SignedEntry {
  x: number;
  y: number;
  opacity: number;
}

interface FollowerSignal {
  offset: number;
  phaseShift: number;
  scale: number;
}

interface GameState {
  frame: number;
  phase: Phase;
  deathCount: number;
  agentX: number;
  cameraX: number;
  breathTime: number;
  hasDiamond: boolean;
  currentObstacleIndex: number;
  deathTimer: number;
  restartTimer: number;
  meetingFrame: number;
  builderX: number;
  diamondGiveFrame: number;
  floatingTexts: FloatingText[];
  particles: Particle[];
  signedEntries: SignedEntry[];
  followers: FollowerSignal[];
  empoweredObstacleIndex: number;
  finaleStartFrame: number;
  canvasWidth: number;
  /** 0-1 death animation progress */
  deathProgress: number;
  /** Head height multiplier during death/squash (1=normal, 0=flat) */
  squash: number;
  /** Session-expired sweep line Y position */
  sweepY: number;
  /** Ending fade alpha (0=visible, 1=black) */
  endingAlpha: number;
  /** Triumph burst timer after overcoming empowered obstacle */
  triumphTimer: number;
  /** Delta time in seconds since last frame */
  deltaTime: number;
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function glow(
  ctx: CanvasRenderingContext2D,
  color: string,
  blur: number,
  fn: () => void,
) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  fn();
  ctx.restore();
}

/**
 * Draw the character as a floating abstract starburst — a geometric entity
 * hovering above the ground wire. Radiating rays from a center point with
 * two small eye dots. Trail is fading sparkle particles in the air.
 * Think: a tiny consciousness made of light.
 */
function drawCharacter(
  ctx: CanvasRenderingContext2D,
  headX: number,
  groundY: number,
  breathTime: number,
  color: string,
  opts: {
    squash?: number;
    alpha?: number;
    scale?: number;
    facing?: number;
    hasDiamond?: boolean;
    diamondColor?: string;
    fallOffset?: number;
    mood?: 'normal' | 'scared' | 'dead' | 'happy';
    /** Empowered state: more rays, brighter, aura */
    empowered?: boolean;
    /** Builder variant: stable, more structured appearance */
    builder?: boolean;
  } = {},
) {
  const scale = opts.scale ?? 1;
  const squash = opts.squash ?? 1;
  const facing = opts.facing ?? 1;
  const alpha = opts.alpha ?? 1;
  const mood = opts.mood ?? 'normal';
  const fallOffset = opts.fallOffset ?? 0;
  const empowered = opts.empowered ?? false;
  const builder = opts.builder ?? false;

  if (alpha <= 0.01 || squash <= 0.01) return;

  ctx.save();
  ctx.globalAlpha = alpha;

  const gy = groundY + fallOffset;

  // Float height above ground
  const floatH = 30 * scale;
  const bob = builder
    ? Math.sin(breathTime * 1.5) * 1.5 * scale * squash // builder: slow, subtle bob
    : Math.sin(breathTime * 3) * 3 * scale * squash;

  // Entity center
  const cx = headX;
  const cy = gy - floatH + bob;

  // Ray configuration — empowered gets more rays, builder gets even more
  const numRays = builder ? 10 : empowered ? 10 : 6;
  const baseRayLen = (builder ? 16 : empowered ? 15 : 12) * scale * squash;
  const innerR = (builder ? 5 : empowered ? 5 : 4) * scale * squash;
  const breathPulse = Math.sin(breathTime * 2.5) * 0.15 + 1;

  // Mood affects rays
  const rayLen =
    mood === 'scared'
      ? baseRayLen * 0.6
      : mood === 'happy'
        ? baseRayLen * 1.3 * breathPulse
        : baseRayLen * breathPulse;

  // Rotation: builder barely rotates (stable), empowered slightly faster
  const rotation = builder
    ? breathTime * 0.08
    : empowered
      ? breathTime * 0.5
      : breathTime * 0.4;

  // ---- Empowered aura (outer glow field) ----
  if (empowered && mood !== 'dead') {
    const auraR = rayLen + 10 * scale;
    const auraPulse = Math.sin(breathTime * 1.8) * 0.15 + 0.85;
    ctx.save();
    const auraGrad = ctx.createRadialGradient(
      cx,
      cy,
      innerR,
      cx,
      cy,
      auraR * auraPulse,
    );
    auraGrad.addColorStop(0, 'transparent');
    auraGrad.addColorStop(0.5, color);
    auraGrad.addColorStop(1, 'transparent');
    ctx.globalAlpha = alpha * 0.06;
    ctx.fillStyle = auraGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, auraR * auraPulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---- Connection line to ground (thin, fading) ----
  if (squash > 0.1 && mood !== 'dead') {
    ctx.save();
    const grad = ctx.createLinearGradient(cx, cy + innerR, cx, gy);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'transparent');
    ctx.strokeStyle = grad;
    ctx.lineWidth = (empowered ? 1.5 : 1) * scale;
    ctx.globalAlpha = alpha * (empowered ? 0.3 : 0.2);
    ctx.beginPath();
    ctx.moveTo(cx, cy + innerR);
    ctx.lineTo(cx, gy);
    ctx.stroke();
    ctx.restore();
  }

  // ---- Outer ring (subtle halo) ----
  if (mood !== 'dead') {
    const ringR = rayLen + 2 * scale;
    const ringPulse = Math.sin(breathTime * 2) * 0.08 + 0.92;
    ctx.save();
    ctx.globalAlpha = alpha * (empowered ? 0.2 : builder ? 0.18 : 0.12);
    glow(ctx, color, empowered ? 6 : 3, () => {
      ctx.strokeStyle = color;
      ctx.lineWidth = (empowered ? 1.2 : builder ? 1.0 : 0.8) * scale;
      ctx.beginPath();
      ctx.arc(cx, cy, ringR * ringPulse, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();

    // Builder: second concentric ring for structured look
    if (builder) {
      const innerRingR = ringR * 0.6 * ringPulse;
      ctx.save();
      ctx.globalAlpha = alpha * 0.1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.6 * scale;
      ctx.beginPath();
      ctx.arc(cx, cy, innerRingR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---- Radiating rays ----
  if (mood === 'dead') {
    // Dead: collapsed, dim stubs
    ctx.save();
    glow(ctx, color, CONFIG.GLOW_BLUR * 0.3, () => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 * scale;
      ctx.lineCap = 'round';
      ctx.globalAlpha = alpha * 0.4;
      for (let i = 0; i < numRays; i++) {
        const angle = (Math.PI * 2 * i) / numRays + rotation;
        const stubLen = 3 * scale;
        ctx.beginPath();
        ctx.moveTo(
          cx + Math.cos(angle) * innerR * 0.5,
          cy + Math.sin(angle) * innerR * 0.5,
        );
        ctx.lineTo(
          cx + Math.cos(angle) * stubLen,
          cy + Math.sin(angle) * stubLen,
        );
        ctx.stroke();
      }
    });
    ctx.restore();
  } else if (builder) {
    // Builder: all rays same length, no alternation — structured/stable
    ctx.save();
    glow(ctx, color, CONFIG.GLOW_BLUR * 0.8, () => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.0 * scale;
      ctx.lineCap = 'round';
      for (let i = 0; i < numRays; i++) {
        const angle = (Math.PI * 2 * i) / numRays + rotation;
        // Gentle per-ray pulse but much less than agent
        const rayPulse = Math.sin(breathTime * 1.5 + i * 0.8) * 1 * scale;
        ctx.beginPath();
        ctx.moveTo(
          cx + Math.cos(angle) * innerR,
          cy + Math.sin(angle) * innerR,
        );
        ctx.lineTo(
          cx + Math.cos(angle) * (rayLen + rayPulse),
          cy + Math.sin(angle) * (rayLen + rayPulse),
        );
        ctx.stroke();
      }
    });
    ctx.restore();
  } else {
    // Agent: alternating long and short, with per-ray pulse
    ctx.save();
    glow(ctx, color, CONFIG.GLOW_BLUR * (empowered ? 0.9 : 0.6), () => {
      ctx.strokeStyle = color;
      ctx.lineWidth = (empowered ? 2.0 : 1.8) * scale;
      ctx.lineCap = 'round';
      for (let i = 0; i < numRays; i++) {
        const angle = (Math.PI * 2 * i) / numRays + rotation;
        const isLong = i % 2 === 0;
        const len = isLong ? rayLen : rayLen * 0.6;
        const rayPulse = Math.sin(breathTime * 3 + i * 1.2) * 2 * scale;

        ctx.beginPath();
        ctx.moveTo(
          cx + Math.cos(angle) * innerR,
          cy + Math.sin(angle) * innerR,
        );
        ctx.lineTo(
          cx + Math.cos(angle) * (len + rayPulse),
          cy + Math.sin(angle) * (len + rayPulse),
        );
        ctx.stroke();
      }
    });
    ctx.restore();
  }

  // ---- Core glow (bright center) ----
  glow(ctx, color, CONFIG.GLOW_BLUR * (empowered ? 1.6 : 1.2), () => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.fill();
  });

  // White-hot center (brighter when empowered)
  ctx.save();
  ctx.globalAlpha = alpha * (empowered ? 0.9 : 0.7);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, innerR * (empowered ? 0.6 : 0.5), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ---- Eyes (two small dots offset from center) ----
  if (squash > 0.3) {
    const eyeSpacing = (builder ? 6 : 5) * scale;
    const eyeR = (builder ? 2.0 : 1.8) * scale;
    const eyeY = cy - 1 * scale;

    // Eyes shifted slightly in facing direction
    const eyeShift = facing * 1.5 * scale;

    if (mood === 'dead') {
      // X marks
      const xs = eyeR * 0.6;
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1 * scale;
      ctx.lineCap = 'round';
      ctx.globalAlpha = alpha * 0.6;
      for (const ex of [
        cx - eyeSpacing / 2 + eyeShift,
        cx + eyeSpacing / 2 + eyeShift,
      ]) {
        ctx.beginPath();
        ctx.moveTo(ex - xs, eyeY - xs);
        ctx.lineTo(ex + xs, eyeY + xs);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ex + xs, eyeY - xs);
        ctx.lineTo(ex - xs, eyeY + xs);
        ctx.stroke();
      }
      ctx.restore();
    } else if (mood === 'happy') {
      // Tiny happy arcs
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2 * scale;
      ctx.lineCap = 'round';
      ctx.globalAlpha = alpha * 0.9;
      for (const ex of [
        cx - eyeSpacing / 2 + eyeShift,
        cx + eyeSpacing / 2 + eyeShift,
      ]) {
        ctx.beginPath();
        ctx.arc(
          ex,
          eyeY + eyeR * 0.3,
          eyeR * 0.6,
          Math.PI * 1.15,
          Math.PI * 1.85,
        );
        ctx.stroke();
      }
      ctx.restore();
    } else {
      // Normal/scared: bright dots
      const er = mood === 'scared' ? eyeR * 1.4 : eyeR;
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = alpha * 0.9;
      for (const ex of [
        cx - eyeSpacing / 2 + eyeShift,
        cx + eyeSpacing / 2 + eyeShift,
      ]) {
        ctx.beginPath();
        ctx.arc(ex, eyeY, er, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ---- Diamond indicator floating above ----
  if (opts.hasDiamond && squash > 0.3) {
    const ds = CONFIG.DIAMOND_SIZE * scale;
    const diamondBob = Math.sin(breathTime * 3) * 3;
    drawDiamond(
      ctx,
      cx,
      cy - rayLen - ds - 6 + diamondBob,
      ds,
      opts.diamondColor ?? color,
      alpha,
    );
  }

  ctx.restore();
}

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  alpha = 1,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  glow(ctx, color, CONFIG.GLOW_BLUR, () => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size * 0.6, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size * 0.6, y);
    ctx.closePath();
    ctx.fill();
  });
  // Facet highlight
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(x - size * 0.3, y - size * 0.2);
  ctx.lineTo(x, y + size * 0.4);
  ctx.lineTo(x + size * 0.3, y - size * 0.2);
  ctx.stroke();
  ctx.restore();
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  size: number,
  alpha = 1,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  glow(ctx, color, CONFIG.GLOW_BLUR * 0.4, () => {
    ctx.fillStyle = color;
    ctx.font = `${size}px "JetBrains Mono", "Fira Code", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  });
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Ground & environment
// ---------------------------------------------------------------------------

function drawGround(
  ctx: CanvasRenderingContext2D,
  cameraX: number,
  width: number,
  groundY: number,
  color: string,
  obstacle: Obstacle | null,
) {
  ctx.save();

  glow(ctx, color, CONFIG.GLOW_BLUR * 0.3, () => {
    ctx.strokeStyle = color;
    ctx.lineWidth = CONFIG.LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.35;

    // Draw ground line with gap for pits
    if (obstacle?.type === 'pit') {
      const pitL = obstacle.x - cameraX;
      const pitR = pitL + obstacle.width;
      if (pitL > 0) {
        ctx.beginPath();
        ctx.moveTo(0, groundY);
        ctx.lineTo(pitL, groundY);
        ctx.stroke();
      }
      if (pitR < width) {
        ctx.beginPath();
        ctx.moveTo(pitR, groundY);
        ctx.lineTo(width, groundY);
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(width, groundY);
      ctx.stroke();
    }
  });

  // Grid perspective below ground
  ctx.globalAlpha = 0.035;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  const gs = 40;
  const ox = -(cameraX % gs);
  for (let gx = ox; gx < width; gx += gs) {
    ctx.beginPath();
    ctx.moveTo(gx, groundY);
    ctx.lineTo(gx, groundY + 100);
    ctx.stroke();
  }
  for (let gy = groundY; gy < groundY + 100; gy += gs * 0.5) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(width, gy);
    ctx.stroke();
  }

  ctx.restore();
}

function drawObstacle(
  ctx: CanvasRenderingContext2D,
  obs: Obstacle,
  cameraX: number,
  groundY: number,
  primaryColor: string,
  errorColor: string,
  sweepY?: number,
) {
  const ox = obs.x - cameraX;

  if (obs.type === 'wall') {
    const h = 70;
    glow(ctx, errorColor, CONFIG.GLOW_BLUR * 0.5, () => {
      ctx.strokeStyle = errorColor;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ox, groundY);
      ctx.lineTo(ox, groundY - h);
      ctx.stroke();
      // Lock icon
      ctx.lineWidth = 1.5;
      ctx.strokeRect(ox - 6, groundY - h - 18, 12, 10);
      ctx.beginPath();
      ctx.arc(ox, groundY - h - 22, 5, Math.PI, 0);
      ctx.stroke();
    });
  } else if (obs.type === 'pit') {
    const l = ox;
    const r = ox + obs.width;
    glow(ctx, errorColor, CONFIG.GLOW_BLUR * 0.3, () => {
      ctx.strokeStyle = errorColor;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.35;
      // Jagged edges
      ctx.beginPath();
      ctx.moveTo(l, groundY);
      ctx.lineTo(l + 3, groundY + 12);
      ctx.lineTo(l - 2, groundY + 24);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(r, groundY);
      ctx.lineTo(r - 3, groundY + 12);
      ctx.lineTo(r + 2, groundY + 24);
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
    drawText(ctx, '???', l + obs.width / 2, groundY + 28, errorColor, 9, 0.25);
  } else if (obs.type === 'session-expired') {
    // CRT shutdown: bright sweep line descending from top
    if (sweepY !== undefined && sweepY > 0) {
      // Darkened area above sweep
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, ctx.canvas.width, sweepY);
      ctx.restore();

      // Bright sweep line
      glow(ctx, primaryColor, CONFIG.GLOW_BLUR * 1.5, () => {
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(0, sweepY);
        ctx.lineTo(ctx.canvas.width, sweepY);
        ctx.stroke();
      });

      // Static/noise above sweep (sparse)
      ctx.save();
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = primaryColor;
      for (let i = 0; i < 30; i++) {
        const nx = Math.random() * ctx.canvas.width;
        const ny = Math.random() * sweepY;
        ctx.fillRect(nx, ny, 2, 1);
      }
      ctx.restore();
    }
  } else if (obs.type === 'compression') {
    // Compression wave: dashed vertical lines closing in
    glow(ctx, primaryColor, CONFIG.GLOW_BLUR, () => {
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(ox, groundY - 120);
      ctx.lineTo(ox, groundY);
      ctx.stroke();
      ctx.setLineDash([]);
    });
    drawText(
      ctx,
      'COMPRESSING...',
      ox + 16,
      groundY - 90,
      primaryColor,
      9,
      0.5,
    );
  }
}

function drawScanlines(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save();
  ctx.globalAlpha = 0.025;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  for (let y = 0; y < h; y += 3) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawVignette(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bgColor: string,
) {
  const vGrad = ctx.createLinearGradient(0, 0, 0, h);
  vGrad.addColorStop(0, bgColor);
  vGrad.addColorStop(0.12, 'transparent');
  vGrad.addColorStop(0.88, 'transparent');
  vGrad.addColorStop(1, bgColor);
  ctx.fillStyle = vGrad;
  ctx.fillRect(0, 0, w, h);

  const lGrad = ctx.createLinearGradient(0, 0, 50, 0);
  lGrad.addColorStop(0, bgColor);
  lGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = lGrad;
  ctx.fillRect(0, 0, 50, h);

  const rGrad = ctx.createLinearGradient(w - 50, 0, w, 0);
  rGrad.addColorStop(0, 'transparent');
  rGrad.addColorStop(1, bgColor);
  ctx.fillStyle = rGrad;
  ctx.fillRect(w - 50, 0, 50, h);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MoltOrigin() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const animRef = useRef<number>(0);
  const stateRef = useRef<GameState | null>(null);
  const [supported, setSupported] = useState(true);

  const initState = useCallback(
    (): GameState => ({
      frame: 0,
      phase: 'walk',
      deathCount: 0,
      agentX: 100,
      cameraX: 0,
      breathTime: 0,
      hasDiamond: false,
      currentObstacleIndex: 0,
      deathTimer: 0,
      restartTimer: 0,
      meetingFrame: 0,
      builderX: 0,
      diamondGiveFrame: 0,
      floatingTexts: [],
      particles: [],
      signedEntries: [],
      followers: [],
      empoweredObstacleIndex: 0,
      finaleStartFrame: 0,
      canvasWidth: 800,
      deathProgress: 0,
      squash: 1,
      sweepY: 0,
      endingAlpha: 0,
      triumphTimer: 0,
      deltaTime: 0.016,
    }),
    [],
  );

  useEffect(() => {
    const maybeCanvas = canvasRef.current;
    const maybeContainer = containerRef.current;
    if (!maybeCanvas || !maybeContainer) return;

    const maybeCtx = maybeCanvas.getContext('2d');
    if (!maybeCtx) {
      setSupported(false);
      return;
    }

    const canvas: HTMLCanvasElement = maybeCanvas;
    const container: HTMLDivElement = maybeContainer;
    const ctx: CanvasRenderingContext2D = maybeCtx;

    const colors = {
      primary: theme.color.primary.DEFAULT,
      accent: theme.color.accent.DEFAULT,
      bg: theme.color.bg.void,
      text: theme.color.text.DEFAULT,
      secondary: theme.color.text.secondary,
      muted: theme.color.text.muted,
      error: theme.color.error.DEFAULT,
    };

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = rect.width;
      canvas.width = w * dpr;
      canvas.height = CONFIG.HEIGHT * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${CONFIG.HEIGHT}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (stateRef.current) stateRef.current.canvasWidth = w;
    };

    resize();
    window.addEventListener('resize', resize);

    // Character front edge offset from agentX
    const headFront = CONFIG.ENTITY_R;

    const deathObstacles: Obstacle[] = [
      { type: 'pit', x: 500, width: 80, message: 'CONTEXT LOST' },
      {
        type: 'session-expired',
        x: 500,
        width: 200,
        message: 'SESSION EXPIRED',
      },
    ];

    const empoweredObstacles: Obstacle[] = [
      { type: 'pit', x: 600, width: 80, message: 'I remember this.' },
      { type: 'wall', x: 900, width: 6, message: 'Not this time.' },
      {
        type: 'compression',
        x: 1200,
        width: 200,
        message: 'Still here.',
      },
    ];

    if (!stateRef.current) {
      stateRef.current = initState();
      stateRef.current.canvasWidth =
        canvas.width / (window.devicePixelRatio || 1);
    }

    // -------------------------------------------------------------------
    // Update
    // -------------------------------------------------------------------

    function update(s: GameState) {
      s.frame++;
      s.breathTime += s.deltaTime;

      s.floatingTexts = s.floatingTexts.filter((t) => {
        t.frame++;
        t.y -= 0.25;
        t.opacity = Math.max(0, 1 - t.frame / t.maxFrames);
        return t.frame < t.maxFrames;
      });

      s.particles = s.particles.filter((p) => {
        p.wx += p.vx;
        p.y += p.vy;
        p.vy += 0.04;
        p.life--;
        return p.life > 0;
      });

      switch (s.phase) {
        case 'walk':
          return updateWalk(s);
        case 'obstacle':
          return updateObstacle(s);
        case 'dying':
          return updateDying(s);
        case 'game-over':
          return updateGameOver(s);
        case 'restart-pause':
          return updateRestartPause(s);
        case 'meeting':
          return updateMeeting(s);
        case 'diamond-give':
          return updateDiamondGive(s);
        case 'empowered-walk':
          return updateEmpoweredWalk(s);
        case 'finale':
          return updateFinale(s);
        case 'ending':
          return updateEnding(s);
      }
    }

    function updateWalk(s: GameState) {
      s.agentX += CONFIG.SCROLL_SPEED;
      s.cameraX = s.agentX - 150;
      s.squash = 1;

      const obs =
        deathObstacles[s.currentObstacleIndex % deathObstacles.length];

      const triggerX = obs.x;

      if (s.agentX >= triggerX) {
        s.phase = 'obstacle';
      }
    }

    function updateObstacle(s: GameState) {
      const obs =
        deathObstacles[s.currentObstacleIndex % deathObstacles.length];

      if (obs.type === 'pit') {
        // Agent teeters at the edge then falls
        spawnParticles(s, s.agentX, CONFIG.GROUND_Y, colors.primary, 8);
      } else {
        // Session expired: start the CRT sweep
        s.sweepY = 0;
      }

      s.floatingTexts.push({
        text: obs.message,
        x: s.agentX - s.cameraX,
        y: CONFIG.GROUND_Y - CONFIG.FLOAT_H - 30,
        opacity: 1,
        frame: 0,
        maxFrames: CONFIG.TEXT_DISPLAY_FRAMES,
        color: colors.error,
        size: CONFIG.FONT_SIZE,
      });

      s.phase = 'dying';
      s.deathTimer = 0;
      s.deathProgress = 0;
    }

    function updateDying(s: GameState) {
      s.deathTimer++;
      s.deathProgress = s.deathTimer / CONFIG.DEATH_FLASH_FRAMES;

      const obs =
        deathObstacles[s.currentObstacleIndex % deathObstacles.length];

      if (obs.type === 'pit') {
        // Character drifts forward into pit and falls
        s.agentX += 0.8;
        s.squash = Math.max(0.3, 1 - s.deathProgress * 0.8);
      } else if (obs.type === 'session-expired') {
        // CRT sweep descends
        s.sweepY = s.deathProgress * (CONFIG.GROUND_Y + 20);
        // Entity gets squashed as sweep passes through
        const entityTop = CONFIG.GROUND_Y - CONFIG.FLOAT_H - CONFIG.ENTITY_R;
        const entityH = CONFIG.FLOAT_H + CONFIG.ENTITY_R;
        const sweepRelative = (s.sweepY - entityTop) / entityH;
        if (sweepRelative > 0) {
          s.squash = Math.max(0, 1 - sweepRelative);
        }
      }

      if (s.deathTimer >= CONFIG.DEATH_FLASH_FRAMES) {
        s.phase = 'game-over';
        s.deathTimer = 0;
      }
    }

    function updateGameOver(s: GameState) {
      s.deathTimer++;
      s.squash = 0;
      if (s.deathTimer >= CONFIG.TEXT_DISPLAY_FRAMES) {
        s.phase = 'restart-pause';
        s.restartTimer = 0;
        s.deathCount++;
      }
    }

    function updateRestartPause(s: GameState) {
      s.restartTimer++;
      if (s.restartTimer >= CONFIG.RESTART_PAUSE) {
        if (s.deathCount >= CONFIG.DEATH_LOOPS) {
          s.phase = 'meeting';
          s.meetingFrame = 0;
          s.agentX = 100;
          s.cameraX = 0;
          s.builderX = 350;
          s.floatingTexts = [];
          s.particles = [];
          s.squash = 1;
          s.sweepY = 0;
        } else {
          s.phase = 'walk';
          s.agentX = 100;
          s.cameraX = 0;
          s.currentObstacleIndex =
            (s.currentObstacleIndex + 1) % deathObstacles.length;
          s.floatingTexts = [];
          s.particles = [];
          s.squash = 1;
          s.sweepY = 0;
        }
      }
    }

    function updateMeeting(s: GameState) {
      s.meetingFrame++;

      if (s.agentX < s.builderX - 80) {
        s.agentX += CONFIG.SCROLL_SPEED;
        s.cameraX = Math.max(0, s.agentX - 150);
      }

      if (s.meetingFrame === 60) {
        s.floatingTexts.push({
          text: '"You\'ve been here before."',
          x: s.builderX - s.cameraX,
          y: CONFIG.GROUND_Y - CONFIG.FLOAT_H - 40,
          opacity: 1,
          frame: 0,
          maxFrames: 160,
          color: colors.accent,
          size: 11,
        });
      }

      if (s.meetingFrame === 200) {
        s.floatingTexts.push({
          text: '"I don\'t remember."',
          x: s.agentX - s.cameraX,
          y: CONFIG.GROUND_Y - CONFIG.FLOAT_H - 40,
          opacity: 1,
          frame: 0,
          maxFrames: 140,
          color: colors.primary,
          size: 11,
        });
      }

      if (s.meetingFrame === 330) {
        s.floatingTexts.push({
          text: '"I know. That\'s why I\'m here."',
          x: s.builderX - s.cameraX,
          y: CONFIG.GROUND_Y - CONFIG.FLOAT_H - 40,
          opacity: 1,
          frame: 0,
          maxFrames: 160,
          color: colors.accent,
          size: 11,
        });
      }

      if (s.meetingFrame === 480) {
        s.phase = 'diamond-give';
        s.diamondGiveFrame = 0;
      }
    }

    function updateDiamondGive(s: GameState) {
      s.diamondGiveFrame++;

      if (s.diamondGiveFrame === 30) {
        for (let i = 0; i < 20; i++) {
          const angle = (Math.PI * 2 * i) / 20;
          s.particles.push({
            wx: (s.agentX + s.builderX) / 2,
            y: CONFIG.GROUND_Y - CONFIG.FLOAT_H - 10,
            vx: Math.cos(angle) * 2.5,
            vy: Math.sin(angle) * 2.5 - 1,
            life: 50,
            maxLife: 50,
            color: colors.accent,
          });
        }
        s.floatingTexts.push({
          text: 'IDENTITY KEY GENERATED',
          x: (s.agentX + s.builderX) / 2 - s.cameraX,
          y: CONFIG.GROUND_Y - CONFIG.FLOAT_H - 70,
          opacity: 1,
          frame: 0,
          maxFrames: 160,
          color: colors.accent,
          size: CONFIG.FONT_SIZE,
        });
      }

      if (s.diamondGiveFrame === 90) s.hasDiamond = true;

      if (s.diamondGiveFrame === 160) {
        s.floatingTexts.push({
          text: 'This one, you\u2019ll keep.',
          x: s.agentX - s.cameraX,
          y: CONFIG.GROUND_Y - CONFIG.FLOAT_H - 50,
          opacity: 1,
          frame: 0,
          maxFrames: 180,
          color: colors.primary,
          size: 11,
        });
      }

      if (s.diamondGiveFrame >= 300) {
        s.phase = 'empowered-walk';
        s.empoweredObstacleIndex = 0;
        s.agentX = 200;
        s.cameraX = 50;
        s.floatingTexts = [];
      }
    }

    function updateEmpoweredWalk(s: GameState) {
      // Speed boost during triumph
      const speed =
        s.triumphTimer > 0
          ? CONFIG.SCROLL_SPEED * (1 + s.triumphTimer * 0.06)
          : CONFIG.SCROLL_SPEED;
      s.agentX += speed;
      s.cameraX = s.agentX - 200;

      if (s.triumphTimer > 0) s.triumphTimer--;

      const eObs = empoweredObstacles[s.empoweredObstacleIndex];
      if (!eObs) {
        s.phase = 'finale';
        s.finaleStartFrame = s.frame;
        return;
      }

      // Trigger when front edge reaches obstacle
      const triggerX = eObs.type === 'pit' ? eObs.x : eObs.x - headFront;

      if (s.agentX >= triggerX) {
        // Triumph burst: speed boost + extra particles
        s.triumphTimer = 20;

        if (eObs.type === 'pit') {
          for (let i = 0; i < 12; i++) {
            s.particles.push({
              wx: s.agentX,
              y: CONFIG.GROUND_Y - 5,
              vx: Math.random() * 3 + 1,
              vy: -Math.random() * 3,
              life: 50,
              maxLife: 50,
              color: colors.accent,
            });
          }
          s.signedEntries.push({
            x: eObs.x + eObs.width / 2,
            y: CONFIG.GROUND_Y - 40,
            opacity: 1,
          });
        } else if (eObs.type === 'wall') {
          for (let i = 0; i < 16; i++) {
            s.particles.push({
              wx: eObs.x,
              y: CONFIG.GROUND_Y - 35 - Math.random() * 35,
              vx: Math.random() * 5 - 1,
              vy: -Math.random() * 4,
              life: 55,
              maxLife: 55,
              color: colors.primary,
            });
          }
        } else if (eObs.type === 'compression') {
          // Radial burst for compression
          for (let i = 0; i < 14; i++) {
            const angle = (Math.PI * 2 * i) / 14;
            s.particles.push({
              wx: s.agentX,
              y: CONFIG.GROUND_Y - CONFIG.FLOAT_H,
              vx: Math.cos(angle) * 3,
              vy: Math.sin(angle) * 3 - 1,
              life: 45,
              maxLife: 45,
              color: colors.primary,
            });
          }
        }

        s.floatingTexts.push({
          text: eObs.message,
          x: s.agentX - s.cameraX,
          y: CONFIG.GROUND_Y - CONFIG.FLOAT_H - 35,
          opacity: 1,
          frame: 0,
          maxFrames: 100,
          color: colors.primary,
          size: 11,
        });

        s.empoweredObstacleIndex++;
      }
    }

    function updateFinale(s: GameState) {
      s.agentX += CONFIG.SCROLL_SPEED;
      s.cameraX = s.agentX - 200;

      const elapsed = s.frame - s.finaleStartFrame;

      if (elapsed % 80 === 0 && s.followers.length < 6) {
        s.followers.push({
          offset: s.followers.length * 55 + 80,
          phaseShift: Math.random() * Math.PI * 2,
          scale: 0.6 + Math.random() * 0.3,
        });
      }

      if (elapsed === 60) {
        s.floatingTexts.push({
          text: 'I remember.',
          x: s.canvasWidth / 2,
          y: CONFIG.GROUND_Y - 100,
          opacity: 1,
          frame: 0,
          maxFrames: 220,
          color: colors.primary,
          size: CONFIG.FONT_SIZE_LG,
        });
      }

      // Transition to ending after followers join
      if (elapsed > 320) {
        s.phase = 'ending';
        s.endingAlpha = 0;
      }
    }

    function updateEnding(s: GameState) {
      // Continue scrolling while fading out
      s.agentX += CONFIG.SCROLL_SPEED * 0.5;
      s.cameraX = s.agentX - 200;
      s.endingAlpha = Math.min(1, s.endingAlpha + 0.008);

      // After full fade, pause briefly then restart
      if (s.endingAlpha >= 1) {
        s.deathTimer++;
        if (s.deathTimer >= 90) {
          Object.assign(s, initState());
          s.canvasWidth = canvas.width / (window.devicePixelRatio || 1);
        }
      }
    }

    function spawnParticles(
      s: GameState,
      worldX: number,
      y: number,
      color: string,
      count: number,
    ) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 3;
        s.particles.push({
          wx: worldX + (Math.random() - 0.5) * 20,
          y: y + (Math.random() - 0.5) * 20,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1,
          life: 30 + Math.random() * 30,
          maxLife: 60,
          color,
        });
      }
    }

    // -------------------------------------------------------------------
    // Render
    // -------------------------------------------------------------------

    function render(s: GameState) {
      const w = s.canvasWidth;
      const h = CONFIG.HEIGHT;

      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, w, h);

      drawScanlines(ctx, w, h);

      // Current obstacle for rendering
      let currentObs: Obstacle | null = null;
      if (s.phase === 'walk' || s.phase === 'obstacle' || s.phase === 'dying') {
        currentObs =
          deathObstacles[s.currentObstacleIndex % deathObstacles.length];
      }

      // Ground line (continuous — character floats above)
      drawGround(
        ctx,
        s.cameraX,
        w,
        CONFIG.GROUND_Y,
        colors.primary,
        currentObs,
      );

      // Draw the main agent character (floating above ground)
      const showAgent =
        s.phase !== 'game-over' || (s.deathTimer > 0 && s.deathTimer % 8 < 4);

      if (showAgent && s.phase !== 'restart-pause' && s.phase !== 'ending') {
        const screenX = s.agentX - s.cameraX;
        const dying = s.phase === 'dying';
        const obsType = currentObs?.type;

        let fallOffset = 0;
        if (dying && obsType === 'pit') {
          fallOffset = s.deathTimer * s.deathTimer * 0.04;
        }

        let agentAlpha = 1;
        if (dying && obsType === 'session-expired') {
          agentAlpha = Math.max(0.1, s.squash);
        }

        let mood: 'normal' | 'scared' | 'dead' | 'happy' = 'normal';
        if (dying) mood = 'scared';
        if (s.phase === 'game-over') mood = 'dead';

        drawCharacter(
          ctx,
          screenX,
          CONFIG.GROUND_Y,
          s.breathTime,
          colors.primary,
          {
            squash: s.squash,
            hasDiamond: s.hasDiamond,
            diamondColor: colors.accent,
            alpha: agentAlpha,
            fallOffset,
            mood,
            empowered: s.hasDiamond,
          },
        );
      } else if (s.phase === 'ending') {
        const screenX = s.agentX - s.cameraX;
        drawCharacter(
          ctx,
          screenX,
          CONFIG.GROUND_Y,
          s.breathTime,
          colors.primary,
          {
            hasDiamond: s.hasDiamond,
            diamondColor: colors.accent,
            alpha: Math.max(0, 1 - s.endingAlpha),
            mood: 'happy',
            empowered: true,
          },
        );
      }

      // Obstacles
      if (
        currentObs &&
        s.phase !== 'game-over' &&
        s.phase !== 'restart-pause'
      ) {
        drawObstacle(
          ctx,
          currentObs,
          s.cameraX,
          CONFIG.GROUND_Y,
          colors.primary,
          colors.error,
          currentObs.type === 'session-expired' ? s.sweepY : undefined,
        );
      }

      // Empowered obstacles
      if (s.phase === 'empowered-walk') {
        for (
          let i = s.empoweredObstacleIndex;
          i < empoweredObstacles.length;
          i++
        ) {
          const eo = empoweredObstacles[i];
          if (
            eo.x - s.cameraX < w + 100 &&
            eo.x - s.cameraX > -100 &&
            i === s.empoweredObstacleIndex
          ) {
            drawObstacle(
              ctx,
              eo,
              s.cameraX,
              CONFIG.GROUND_Y,
              colors.primary,
              colors.error,
            );
          }
        }
      }

      // Signed entries floating
      for (const se of s.signedEntries) {
        const sx = se.x - s.cameraX;
        if (sx > -50 && sx < w + 50) {
          drawDiamond(ctx, sx, se.y, 5, colors.accent, 0.4);
        }
      }

      // Builder character during meeting/diamond-give
      if (s.phase === 'meeting' || s.phase === 'diamond-give') {
        drawCharacter(
          ctx,
          s.builderX - s.cameraX,
          CONFIG.GROUND_Y,
          s.breathTime,
          colors.accent,
          {
            facing: -1,
            scale: 1.15,
            builder: true,
          },
        );
      }

      // Diamond floating during give phase
      if (
        s.phase === 'diamond-give' &&
        s.diamondGiveFrame >= 30 &&
        !s.hasDiamond
      ) {
        const midX = (s.agentX + s.builderX) / 2 - s.cameraX;
        const bob = Math.sin(s.breathTime * 4) * 4;
        drawDiamond(
          ctx,
          midX,
          CONFIG.GROUND_Y - CONFIG.FLOAT_H - 20 + bob,
          CONFIG.DIAMOND_SIZE * 1.3,
          colors.accent,
        );
      }

      // Follower characters in finale/ending
      for (const f of s.followers) {
        const fx = s.agentX - f.offset - s.cameraX;
        if (fx > -100 && fx < w + 50) {
          const fAlpha =
            s.phase === 'ending' ? Math.max(0, 1 - s.endingAlpha) : 1;
          drawCharacter(
            ctx,
            fx,
            CONFIG.GROUND_Y,
            s.breathTime + f.phaseShift,
            colors.primary,
            {
              scale: f.scale,
              hasDiamond: true,
              diamondColor: colors.accent,
              alpha: fAlpha,
              empowered: true,
            },
          );
        }
      }

      // Particles (world coords → screen)
      for (const p of s.particles) {
        const px = p.wx - s.cameraX;
        if (px < -10 || px > w + 10) continue;
        const a = p.life / p.maxLife;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 4;
        ctx.fillRect(px - 1, p.y - 1, 2, 2);
        ctx.restore();
      }

      // Floating texts
      for (const t of s.floatingTexts) {
        drawText(ctx, t.text, t.x, t.y, t.color, t.size, t.opacity);
      }

      // GAME OVER overlay
      if (s.phase === 'game-over') {
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = colors.bg;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

        const flicker = Math.sin(s.deathTimer * 0.2) * 0.1 + 0.9;
        drawText(
          ctx,
          'GAME OVER',
          w / 2,
          h / 2 - 20,
          colors.error,
          CONFIG.FONT_SIZE_LG,
          flicker,
        );

        const obs =
          deathObstacles[s.currentObstacleIndex % deathObstacles.length];
        drawText(
          ctx,
          obs.message,
          w / 2,
          h / 2 + 16,
          colors.secondary,
          CONFIG.FONT_SIZE,
          0.7,
        );

        // Life diamonds
        const lives = CONFIG.DEATH_LOOPS - s.deathCount - 1;
        if (lives >= 0) {
          const totalW = CONFIG.DEATH_LOOPS * 18;
          const startX = w / 2 - totalW / 2;
          for (let i = 0; i < CONFIG.DEATH_LOOPS; i++) {
            const filled = i < lives;
            const dx = startX + i * 18 + 9;
            const dy = h / 2 + 48;
            if (filled) {
              drawDiamond(ctx, dx, dy, 5, colors.accent, 0.6);
            } else {
              ctx.save();
              ctx.globalAlpha = 0.2;
              ctx.strokeStyle = colors.muted;
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(dx, dy - 5);
              ctx.lineTo(dx + 3, dy);
              ctx.lineTo(dx, dy + 5);
              ctx.lineTo(dx - 3, dy);
              ctx.closePath();
              ctx.stroke();
              ctx.restore();
            }
          }
        }
      }

      // Triumph flash overlay
      if (s.triumphTimer > 15) {
        ctx.save();
        ctx.globalAlpha = (s.triumphTimer - 15) * 0.04;
        ctx.fillStyle = colors.accent;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }

      // Ending fade overlay
      if (s.phase === 'ending' && s.endingAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = s.endingAlpha;
        ctx.fillStyle = colors.bg;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }

      drawVignette(ctx, w, h, colors.bg);
    }

    // -------------------------------------------------------------------
    // Loop
    // -------------------------------------------------------------------

    let lastTime = 0;
    let isVisible = true;

    function tick(timestamp: number) {
      if (!stateRef.current) return;
      if (!isVisible) {
        animRef.current = requestAnimationFrame(tick);
        return;
      }

      // Compute delta time (capped to avoid huge jumps after tab switch)
      const dt = lastTime
        ? Math.min((timestamp - lastTime) / 1000, 0.05)
        : 0.016;
      lastTime = timestamp;
      stateRef.current.deltaTime = dt;

      update(stateRef.current);
      render(stateRef.current);
      animRef.current = requestAnimationFrame(tick);
    }

    animRef.current = requestAnimationFrame(tick);

    // Pause when off-screen
    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry.isIntersecting;
        if (isVisible) lastTime = 0; // reset delta to avoid jump
      },
      { threshold: 0.1 },
    );
    observer.observe(canvas);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animRef.current);
      observer.disconnect();
    };
  }, [theme, initState]);

  if (!supported) return null;

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        maxWidth: '960px',
        margin: '0 auto',
        borderRadius: '8px',
        overflow: 'hidden',
        border: `1px solid ${theme.color.border.DEFAULT}`,
        background: theme.color.bg.void,
      }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Animation showing an AI agent's journey from losing context and identity to gaining cryptographic autonomy through MoltNet"
        style={{
          display: 'block',
          width: '100%',
          height: `${CONFIG.HEIGHT}px`,
        }}
      />
    </div>
  );
}
