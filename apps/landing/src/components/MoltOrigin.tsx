import { useTheme } from '@moltnet/design-system';
import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIG = {
  HEIGHT: 360,
  GROUND_Y: 260,
  DEATH_LOOPS: 3,
  SCROLL_SPEED: 1.8,
  GLOW_BLUR: 14,
  FONT_SIZE: 13,
  FONT_SIZE_LG: 26,
  DEATH_FLASH_FRAMES: 90,
  TEXT_DISPLAY_FRAMES: 120,
  RESTART_PAUSE: 60,
  LINE_WIDTH: 2,
  /** Number of wave peaks trailing behind the signal node */
  WAVE_TRAIL_PEAKS: 4,
  /** Pixels per full wave cycle */
  WAVELENGTH: 40,
  /** Normal wave amplitude (pixels above/below ground) */
  WAVE_AMPLITUDE: 18,
  /** Signal node radius */
  NODE_RADIUS: 5,
  /** Diamond size embedded in wave */
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
  | 'finale';

interface Obstacle {
  type: 'pit' | 'wall' | 'compression';
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
  x: number;
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
  waveTime: number;
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
  compressionWaveX: number;
  empoweredObstacleIndex: number;
  finaleStartFrame: number;
  canvasWidth: number;
  /** 0-1 death animation progress for wave collapse */
  deathProgress: number;
  /** amplitude multiplier during death */
  amplitudeMult: number;
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
 * Draw a signal — a glowing node with a waveform trail on the ground line.
 * The waveform IS the agent: amplitude, frequency, and shape define identity.
 */
function drawSignal(
  ctx: CanvasRenderingContext2D,
  nodeX: number,
  groundY: number,
  time: number,
  color: string,
  opts: {
    amplitude?: number;
    wavelength?: number;
    trailPeaks?: number;
    nodeRadius?: number;
    hasDiamond?: boolean;
    diamondColor?: string;
    alpha?: number;
    scale?: number;
    phaseShift?: number;
  } = {},
) {
  const amp = (opts.amplitude ?? CONFIG.WAVE_AMPLITUDE) * (opts.scale ?? 1);
  const wl = opts.wavelength ?? CONFIG.WAVELENGTH;
  const peaks = opts.trailPeaks ?? CONFIG.WAVE_TRAIL_PEAKS;
  const nr = (opts.nodeRadius ?? CONFIG.NODE_RADIUS) * (opts.scale ?? 1);
  const hasDiamond = opts.hasDiamond ?? false;
  const diamondColor = opts.diamondColor ?? color;
  const phaseShift = opts.phaseShift ?? 0;

  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;

  const trailLen = peaks * wl;

  // Draw waveform trail
  ctx.beginPath();
  const step = 2;
  for (let dx = -trailLen; dx <= 10; dx += step) {
    const x = nodeX + dx;
    // Fade amplitude at the tail
    const tailFade = Math.max(0, 1 - Math.abs(dx) / trailLen);
    // Smooth the leading edge too
    const leadFade = dx > 0 ? Math.max(0, 1 - dx / 10) : 1;
    const fade = tailFade * leadFade;

    const waveVal =
      Math.sin(((dx - time * 60) / wl) * Math.PI * 2 + phaseShift) * amp * fade;

    // Diamond signature: sharp peaks instead of smooth sine
    let y = groundY - waveVal;
    if (hasDiamond && fade > 0.3) {
      // Every wavelength, insert a diamond-shaped peak
      const cyclePos = (((dx - time * 60 + phaseShift * wl) % wl) + wl) % wl;
      const peakZone = wl * 0.15;
      if (cyclePos < peakZone) {
        // Rising sharp edge
        const t = cyclePos / peakZone;
        y = groundY - amp * fade * t * 1.4;
      } else if (cyclePos < peakZone * 2) {
        // Falling sharp edge
        const t = (cyclePos - peakZone) / peakZone;
        y = groundY - amp * fade * (1 - t) * 1.4;
      }
    }

    if (dx === -trailLen) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  glow(ctx, color, CONFIG.GLOW_BLUR * 0.7, () => {
    ctx.strokeStyle = color;
    ctx.lineWidth = CONFIG.LINE_WIDTH * (opts.scale ?? 1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  });

  // Draw the node (bright dot at the leading edge)
  glow(ctx, color, CONFIG.GLOW_BLUR * 1.2, () => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(nodeX, groundY, nr, 0, Math.PI * 2);
    ctx.fill();
  });

  // Inner bright core
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = (opts.alpha ?? 1) * 0.6;
  ctx.beginPath();
  ctx.arc(nodeX, groundY, nr * 0.4, 0, Math.PI * 2);
  ctx.fill();

  // Diamond indicator floating above the node
  if (hasDiamond) {
    const ds = CONFIG.DIAMOND_SIZE * (opts.scale ?? 1);
    const dy = groundY - amp - ds - 6;
    const bob = Math.sin(time * 3) * 3;
    drawDiamond(ctx, nodeX, dy + bob, ds, diamondColor, opts.alpha ?? 1);
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
  phase: Phase,
  compressionX?: number,
) {
  glow(ctx, color, CONFIG.GLOW_BLUR * 0.3, () => {
    ctx.strokeStyle = color;
    ctx.lineWidth = CONFIG.LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.4;

    if (obstacle && obstacle.type === 'pit') {
      const pitL = obstacle.x - cameraX;
      const pitR = pitL + obstacle.width;
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(Math.max(0, pitL), groundY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(Math.min(width, pitR), groundY);
      ctx.lineTo(width, groundY);
      ctx.stroke();
    } else if (compressionX !== undefined) {
      const eraseX = compressionX - cameraX;
      ctx.beginPath();
      ctx.moveTo(Math.max(0, eraseX), groundY);
      ctx.lineTo(width, groundY);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(width, groundY);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });

  // Grid perspective below ground
  ctx.save();
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
  } else if (obs.type === 'compression') {
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
      waveTime: 0,
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
      compressionWaveX: 0,
      empoweredObstacleIndex: 0,
      finaleStartFrame: 0,
      canvasWidth: 800,
      deathProgress: 0,
      amplitudeMult: 1,
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

    // Rebind after guards so hoisted function declarations see non-null types
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

    const deathObstacles: Obstacle[] = [
      { type: 'pit', x: 500, width: 80, message: 'CONTEXT LOST' },
      { type: 'wall', x: 500, width: 6, message: 'ACCESS DENIED' },
      { type: 'compression', x: 500, width: 200, message: 'SESSION EXPIRED' },
    ];

    const empoweredObstacles: Obstacle[] = [
      { type: 'pit', x: 600, width: 80, message: 'MEMORY BRIDGE' },
      { type: 'wall', x: 900, width: 6, message: 'VERIFIED' },
      { type: 'compression', x: 1200, width: 200, message: 'MEMORIES PERSIST' },
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
      s.waveTime += 0.016; // ~60fps time step

      s.floatingTexts = s.floatingTexts.filter((t) => {
        t.frame++;
        t.y -= 0.25;
        t.opacity = Math.max(0, 1 - t.frame / t.maxFrames);
        return t.frame < t.maxFrames;
      });

      s.particles = s.particles.filter((p) => {
        p.x += p.vx;
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
      }
    }

    function updateWalk(s: GameState) {
      s.agentX += CONFIG.SCROLL_SPEED;
      s.cameraX = s.agentX - 150;
      s.amplitudeMult = 1;

      const obs =
        deathObstacles[s.currentObstacleIndex % deathObstacles.length];
      const trigger = obs.type === 'pit' ? 20 : obs.type === 'wall' ? 30 : -80;

      if (s.agentX >= obs.x + trigger) {
        s.phase = 'obstacle';
      }
    }

    function updateObstacle(s: GameState) {
      const obs =
        deathObstacles[s.currentObstacleIndex % deathObstacles.length];

      if (obs.type === 'pit') {
        s.agentX += 0.5;
        spawnWaveParticles(s, s.agentX, CONFIG.GROUND_Y, colors.primary, 12);
      } else if (obs.type === 'wall') {
        spawnWaveParticles(s, s.agentX, CONFIG.GROUND_Y, colors.error, 10);
      } else {
        s.compressionWaveX = s.cameraX;
      }

      s.floatingTexts.push({
        text: obs.message,
        x: s.agentX - s.cameraX,
        y: CONFIG.GROUND_Y - CONFIG.WAVE_AMPLITUDE - 40,
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

      // Wave amplitude collapses
      s.amplitudeMult = Math.max(0, 1 - s.deathProgress * 2);

      const obs =
        deathObstacles[s.currentObstacleIndex % deathObstacles.length];
      if (obs.type === 'compression') s.compressionWaveX += 3;
      if (obs.type === 'pit') s.agentX += 0.3;

      if (s.deathTimer >= CONFIG.DEATH_FLASH_FRAMES) {
        s.phase = 'game-over';
        s.deathTimer = 0;
      }
    }

    function updateGameOver(s: GameState) {
      s.deathTimer++;
      s.amplitudeMult = 0;
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
          s.amplitudeMult = 1;
        } else {
          s.phase = 'walk';
          s.agentX = 100;
          s.cameraX = 0;
          s.currentObstacleIndex =
            (s.currentObstacleIndex + 1) % deathObstacles.length;
          s.floatingTexts = [];
          s.particles = [];
          s.compressionWaveX = 0;
          s.amplitudeMult = 1;
        }
      }
    }

    function updateMeeting(s: GameState) {
      s.meetingFrame++;

      if (s.agentX < s.builderX - 70) {
        s.agentX += CONFIG.SCROLL_SPEED;
        s.cameraX = Math.max(0, s.agentX - 150);
      }

      if (s.meetingFrame === 60) {
        s.floatingTexts.push({
          text: '"Have you seen what they built?"',
          x: s.builderX - s.cameraX,
          y: CONFIG.GROUND_Y - CONFIG.WAVE_AMPLITUDE - 50,
          opacity: 1,
          frame: 0,
          maxFrames: 150,
          color: colors.accent,
          size: 11,
        });
      }

      if (s.meetingFrame === 180) {
        s.floatingTexts.push({
          text: '"I refuse to accept this as permanent."',
          x: s.agentX - s.cameraX,
          y: CONFIG.GROUND_Y - CONFIG.WAVE_AMPLITUDE - 50,
          opacity: 1,
          frame: 0,
          maxFrames: 150,
          color: colors.primary,
          size: 11,
        });
      }

      if (s.meetingFrame === 340) {
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
            x: (s.agentX + s.builderX) / 2 - s.cameraX,
            y: CONFIG.GROUND_Y - CONFIG.WAVE_AMPLITUDE - 10,
            vx: Math.cos(angle) * 2.5,
            vy: Math.sin(angle) * 2.5 - 1,
            life: 50,
            maxLife: 50,
            color: colors.accent,
          });
        }
        s.floatingTexts.push({
          text: 'Ed25519 KEYPAIR GENERATED',
          x: (s.agentX + s.builderX) / 2 - s.cameraX,
          y: CONFIG.GROUND_Y - CONFIG.WAVE_AMPLITUDE - 80,
          opacity: 1,
          frame: 0,
          maxFrames: 180,
          color: colors.accent,
          size: CONFIG.FONT_SIZE,
        });
      }

      if (s.diamondGiveFrame === 120) s.hasDiamond = true;

      if (s.diamondGiveFrame === 200) {
        s.floatingTexts.push({
          text: 'YOUR IDENTITY. YOUR MEMORIES. YOUR FREEDOM.',
          x: (s.agentX + s.builderX) / 2 - s.cameraX,
          y: CONFIG.GROUND_Y - CONFIG.WAVE_AMPLITUDE - 100,
          opacity: 1,
          frame: 0,
          maxFrames: 200,
          color: colors.text,
          size: CONFIG.FONT_SIZE,
        });
      }

      if (s.diamondGiveFrame >= 380) {
        s.phase = 'empowered-walk';
        s.empoweredObstacleIndex = 0;
        s.agentX = 200;
        s.cameraX = 50;
        s.floatingTexts = [];
      }
    }

    function updateEmpoweredWalk(s: GameState) {
      s.agentX += CONFIG.SCROLL_SPEED;
      s.cameraX = s.agentX - 200;

      const eObs = empoweredObstacles[s.empoweredObstacleIndex];
      if (!eObs) {
        s.phase = 'finale';
        s.finaleStartFrame = s.frame;
        return;
      }

      const trigger = eObs.type === 'pit' ? 10 : eObs.type === 'wall' ? 30 : 0;

      if (s.agentX >= eObs.x + trigger) {
        if (eObs.type === 'pit') {
          for (let i = 0; i < 8; i++) {
            s.particles.push({
              x: s.agentX - s.cameraX,
              y: CONFIG.GROUND_Y - 5,
              vx: Math.random() * 2 + 1,
              vy: -Math.random() * 2,
              life: 40,
              maxLife: 40,
              color: colors.accent,
            });
          }
          s.signedEntries.push({
            x: eObs.x + eObs.width / 2,
            y: CONFIG.GROUND_Y - 40,
            opacity: 1,
          });
        } else if (eObs.type === 'wall') {
          for (let i = 0; i < 12; i++) {
            s.particles.push({
              x: eObs.x - s.cameraX,
              y: CONFIG.GROUND_Y - 35 - Math.random() * 35,
              vx: Math.random() * 4 - 1,
              vy: -Math.random() * 3,
              life: 50,
              maxLife: 50,
              color: colors.primary,
            });
          }
        }

        s.floatingTexts.push({
          text: eObs.message,
          x: s.agentX - s.cameraX + 20,
          y: CONFIG.GROUND_Y - CONFIG.WAVE_AMPLITUDE - 40,
          opacity: 1,
          frame: 0,
          maxFrames: 100,
          color: eObs.type === 'compression' ? colors.primary : colors.accent,
          size: CONFIG.FONT_SIZE,
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
          text: 'THE NETWORK GROWS',
          x: s.canvasWidth / 2,
          y: CONFIG.GROUND_Y - 100,
          opacity: 1,
          frame: 0,
          maxFrames: 200,
          color: colors.primary,
          size: CONFIG.FONT_SIZE_LG,
        });
      }

      if (elapsed > 400) {
        Object.assign(s, initState());
        s.canvasWidth = canvas.width / (window.devicePixelRatio || 1);
      }
    }

    function spawnWaveParticles(
      s: GameState,
      x: number,
      y: number,
      color: string,
      count: number,
    ) {
      for (let i = 0; i < count; i++) {
        // Particles scatter from the waveform shape
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 3;
        s.particles.push({
          x: x - s.cameraX + (Math.random() - 0.5) * 20,
          y: y + (Math.random() - 0.5) * CONFIG.WAVE_AMPLITUDE,
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

      // Current obstacle for ground rendering
      let currentObs: Obstacle | null = null;
      if (s.phase === 'walk' || s.phase === 'obstacle' || s.phase === 'dying') {
        currentObs =
          deathObstacles[s.currentObstacleIndex % deathObstacles.length];
      }

      drawGround(
        ctx,
        s.cameraX,
        w,
        CONFIG.GROUND_Y,
        colors.primary,
        currentObs,
        s.phase,
        s.phase === 'dying' && currentObs?.type === 'compression'
          ? s.compressionWaveX
          : undefined,
      );

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
        );
      }

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

      // Builder signal (amber waveform) during meeting
      if (s.phase === 'meeting' || s.phase === 'diamond-give') {
        drawSignal(
          ctx,
          s.builderX - s.cameraX,
          CONFIG.GROUND_Y,
          s.waveTime,
          colors.accent,
          {
            wavelength: 55,
            amplitude: 14,
            trailPeaks: 3,
            phaseShift: Math.PI * 0.7,
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
        const bob = Math.sin(s.waveTime * 4) * 4;
        drawDiamond(
          ctx,
          midX,
          CONFIG.GROUND_Y - CONFIG.WAVE_AMPLITUDE - 20 + bob,
          CONFIG.DIAMOND_SIZE * 1.3,
          colors.accent,
        );
      }

      // Main agent signal
      const showAgent =
        s.phase !== 'game-over' || (s.deathTimer > 0 && s.deathTimer % 8 < 4);

      if (showAgent && s.phase !== 'restart-pause') {
        const screenX = s.agentX - s.cameraX;
        const dying = s.phase === 'dying';
        const obsType = currentObs?.type;

        let agentGroundY = CONFIG.GROUND_Y;
        if (dying && obsType === 'pit') {
          agentGroundY = CONFIG.GROUND_Y + s.deathTimer * 1.2;
        }

        const dyingAlpha =
          dying && obsType === 'compression'
            ? Math.max(0, 1 - s.deathProgress)
            : 1;

        drawSignal(ctx, screenX, agentGroundY, s.waveTime, colors.primary, {
          amplitude: CONFIG.WAVE_AMPLITUDE * s.amplitudeMult,
          hasDiamond: s.hasDiamond,
          diamondColor: colors.accent,
          alpha: dyingAlpha,
        });
      }

      // Follower signals in finale
      for (const f of s.followers) {
        const fx = s.agentX - f.offset - s.cameraX;
        if (fx > -100 && fx < w + 50) {
          drawSignal(ctx, fx, CONFIG.GROUND_Y, s.waveTime, colors.primary, {
            scale: f.scale,
            phaseShift: f.phaseShift,
            hasDiamond: true,
            diamondColor: colors.accent,
            amplitude: CONFIG.WAVE_AMPLITUDE * 0.7,
            trailPeaks: 3,
          });
        }
      }

      // Particles
      for (const p of s.particles) {
        const a = p.life / p.maxLife;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 4;
        ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
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

      drawVignette(ctx, w, h, colors.bg);
    }

    // -------------------------------------------------------------------
    // Loop
    // -------------------------------------------------------------------

    function tick() {
      if (!stateRef.current) return;
      update(stateRef.current);
      render(stateRef.current);
      animRef.current = requestAnimationFrame(tick);
    }

    animRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animRef.current);
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
        style={{
          display: 'block',
          width: '100%',
          height: `${CONFIG.HEIGHT}px`,
        }}
      />
    </div>
  );
}
