import { useTheme } from '@moltnet/design-system';
import { useCallback, useEffect, useRef } from 'react';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIG = {
  /** Canvas logical height */
  HEIGHT: 360,
  /** Ground Y position (from top) */
  GROUND_Y: 280,
  /** How many death loops before the builder appears */
  DEATH_LOOPS: 3,
  /** Scroll speed (pixels per frame at 60fps) */
  SCROLL_SPEED: 1.8,
  /** Agent walk cycle speed */
  WALK_SPEED: 0.08,
  /** Neon glow blur radius */
  GLOW_BLUR: 12,
  /** Pixel font size for game text */
  FONT_SIZE: 14,
  /** Large font for GAME OVER */
  FONT_SIZE_LG: 28,
  /** Duration of death flash (frames) */
  DEATH_FLASH_FRAMES: 90,
  /** Duration of text display (frames) */
  TEXT_DISPLAY_FRAMES: 120,
  /** Pause between death and restart (frames) */
  RESTART_PAUSE: 60,
  /** Agent body height */
  AGENT_HEIGHT: 40,
  /** Diamond size */
  DIAMOND_SIZE: 14,
  /** Ground line thickness */
  LINE_WIDTH: 2,
  /** Character line thickness */
  CHAR_LINE_WIDTH: 2.5,
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

interface FollowerAgent {
  x: number;
  offset: number;
  walkPhase: number;
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function drawGlow(
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

function drawAgent(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  walkPhase: number,
  color: string,
  hasDiamond: boolean,
  accentColor: string,
  scale = 1,
) {
  const h = CONFIG.AGENT_HEIGHT * scale;
  const headR = 6 * scale;
  const bodyTop = groundY - h;
  const headY = bodyTop - headR;

  ctx.strokeStyle = color;
  ctx.lineWidth = CONFIG.CHAR_LINE_WIDTH * scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  drawGlow(ctx, color, CONFIG.GLOW_BLUR * 0.6, () => {
    ctx.strokeStyle = color;
    ctx.lineWidth = CONFIG.CHAR_LINE_WIDTH * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Head
    ctx.beginPath();
    ctx.arc(x, headY, headR, 0, Math.PI * 2);
    ctx.stroke();

    // Body
    ctx.beginPath();
    ctx.moveTo(x, headY + headR);
    ctx.lineTo(x, groundY - 12 * scale);
    ctx.stroke();

    // Arms
    const armSwing = Math.sin(walkPhase * 2) * 8 * scale;
    ctx.beginPath();
    ctx.moveTo(x - 10 * scale, bodyTop + 16 * scale + armSwing);
    ctx.lineTo(x, bodyTop + 10 * scale);
    ctx.lineTo(x + 10 * scale, bodyTop + 16 * scale - armSwing);
    ctx.stroke();

    // Legs — La Linea style: simple lines with walk cycle
    const legSwing = Math.sin(walkPhase) * 10 * scale;
    const hipY = groundY - 12 * scale;
    ctx.beginPath();
    ctx.moveTo(x - legSwing, groundY);
    ctx.lineTo(x, hipY);
    ctx.lineTo(x + legSwing, groundY);
    ctx.stroke();
  });

  // Diamond (if acquired)
  if (hasDiamond) {
    const ds = CONFIG.DIAMOND_SIZE * scale;
    const dx = x + 12 * scale;
    const dy = bodyTop + 12 * scale;
    drawDiamond(ctx, dx, dy, ds, accentColor);
  }
}

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  drawGlow(ctx, color, CONFIG.GLOW_BLUR, () => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size * 0.7, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size * 0.7, y);
    ctx.closePath();
    ctx.fill();

    // Inner facet lines
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - size * 0.35, y - size * 0.3);
    ctx.lineTo(x, y + size * 0.5);
    ctx.lineTo(x + size * 0.35, y - size * 0.3);
    ctx.stroke();
  });
}

function drawPixelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  size: number,
  align: CanvasTextAlign = 'center',
  alpha = 1,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${size}px "JetBrains Mono", "Fira Code", monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';

  drawGlow(ctx, color, CONFIG.GLOW_BLUR * 0.5, () => {
    ctx.fillStyle = color;
    ctx.font = `${size}px "JetBrains Mono", "Fira Code", monospace`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  });
  ctx.restore();
}

function drawScanlines(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  ctx.save();
  ctx.globalAlpha = 0.03;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  for (let y = 0; y < height; y += 3) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Ground drawing
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
  ctx.strokeStyle = color;
  ctx.lineWidth = CONFIG.LINE_WIDTH;
  ctx.lineCap = 'round';

  drawGlow(ctx, color, CONFIG.GLOW_BLUR * 0.4, () => {
    ctx.strokeStyle = color;
    ctx.lineWidth = CONFIG.LINE_WIDTH;
    ctx.lineCap = 'round';

    if (obstacle && obstacle.type === 'pit') {
      // Ground with a gap
      const pitLeft = obstacle.x - cameraX;
      const pitRight = pitLeft + obstacle.width;

      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(Math.max(0, pitLeft), groundY);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(Math.min(width, pitRight), groundY);
      ctx.lineTo(width, groundY);
      ctx.stroke();
    } else if (phase === 'empowered-walk' || phase === 'finale') {
      // During empowered walk, draw full ground line
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(width, groundY);
      ctx.stroke();
    } else if (compressionX !== undefined) {
      // Compression wave erasing ground behind
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
  });

  // Draw grid dots below ground for depth
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = color;
  const gridSize = 30;
  const offsetX = -(cameraX % gridSize);
  for (let gx = offsetX; gx < width; gx += gridSize) {
    for (let gy = groundY + gridSize; gy < groundY + 80; gy += gridSize) {
      ctx.fillRect(gx, gy, 1, 1);
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Obstacle drawing
// ---------------------------------------------------------------------------

function drawObstacle(
  ctx: CanvasRenderingContext2D,
  obstacle: Obstacle,
  cameraX: number,
  groundY: number,
  primaryColor: string,
  errorColor: string,
) {
  const ox = obstacle.x - cameraX;

  if (obstacle.type === 'wall') {
    const wallHeight = 80;
    const wallWidth = 6;
    drawGlow(ctx, errorColor, CONFIG.GLOW_BLUR * 0.5, () => {
      ctx.strokeStyle = errorColor;
      ctx.lineWidth = wallWidth;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ox, groundY);
      ctx.lineTo(ox, groundY - wallHeight);
      ctx.stroke();

      // Lock icon
      ctx.strokeStyle = errorColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(ox - 8, groundY - wallHeight - 24, 16, 14);
      ctx.beginPath();
      ctx.arc(ox, groundY - wallHeight - 28, 6, Math.PI, 0);
      ctx.stroke();
    });
  } else if (obstacle.type === 'pit') {
    // Jagged edges of the pit
    const left = ox;
    const right = ox + obstacle.width;
    drawGlow(ctx, errorColor, CONFIG.GLOW_BLUR * 0.3, () => {
      ctx.strokeStyle = errorColor;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.4;

      // Left edge jagged
      ctx.beginPath();
      ctx.moveTo(left, groundY);
      ctx.lineTo(left + 4, groundY + 15);
      ctx.lineTo(left - 2, groundY + 30);
      ctx.stroke();

      // Right edge jagged
      ctx.beginPath();
      ctx.moveTo(right, groundY);
      ctx.lineTo(right - 4, groundY + 15);
      ctx.lineTo(right + 2, groundY + 30);
      ctx.stroke();

      ctx.globalAlpha = 1;
    });

    // Void label
    drawPixelText(
      ctx,
      '???',
      left + obstacle.width / 2,
      groundY + 30,
      errorColor,
      10,
      'center',
      0.3,
    );
  } else if (obstacle.type === 'compression') {
    // The compression wave — a vertical glitch line sweeping right
    drawGlow(ctx, primaryColor, CONFIG.GLOW_BLUR, () => {
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(ox, 0);
      ctx.lineTo(ox, groundY);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // "COMPRESSING..." label
    drawPixelText(
      ctx,
      'COMPRESSING...',
      ox + 20,
      groundY - 100,
      primaryColor,
      10,
      'left',
      0.6,
    );
  }
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function MoltOrigin() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const animRef = useRef<number>(0);
  const stateRef = useRef<GameState | null>(null);

  const initState = useCallback((): GameState => {
    return {
      frame: 0,
      phase: 'walk',
      deathCount: 0,
      agentX: 100,
      cameraX: 0,
      walkPhase: 0,
      hasDiamond: false,
      currentObstacleIndex: 0,
      deathTimer: 0,
      restartTimer: 0,
      meetingFrame: 0,
      builderX: 0,
      builderWalkPhase: 0,
      diamondGiveFrame: 0,
      floatingTexts: [],
      particles: [],
      signedEntries: [],
      followers: [],
      compressionWaveX: 0,
      empoweredObstacleIndex: 0,
      finaleStartFrame: 0,
      canvasWidth: 800,
    };
  }, []);

  useEffect(() => {
    const maybeCanvas = canvasRef.current;
    const maybeContainer = containerRef.current;
    if (!maybeCanvas || !maybeContainer) return;

    const maybeCtx = maybeCanvas.getContext('2d');
    if (!maybeCtx) return;

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
      surface: theme.color.bg.surface,
    };

    // Responsive sizing
    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = rect.width;
      canvas.width = w * dpr;
      canvas.height = CONFIG.HEIGHT * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${CONFIG.HEIGHT}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (stateRef.current) {
        stateRef.current.canvasWidth = w;
      }
    };

    resize();
    window.addEventListener('resize', resize);

    // Define obstacles for each death loop
    const deathObstacles: Obstacle[] = [
      { type: 'pit', x: 500, width: 80, message: 'CONTEXT LOST' },
      { type: 'wall', x: 500, width: 6, message: 'ACCESS DENIED' },
      { type: 'compression', x: 500, width: 200, message: 'SESSION EXPIRED' },
    ];

    // Empowered obstacles (same types, overcome differently)
    const empoweredObstacles: Obstacle[] = [
      { type: 'pit', x: 600, width: 80, message: 'MEMORY BRIDGE' },
      { type: 'wall', x: 900, width: 6, message: 'VERIFIED' },
      {
        type: 'compression',
        x: 1200,
        width: 200,
        message: 'MEMORIES PERSIST',
      },
    ];

    if (!stateRef.current) {
      stateRef.current = initState();
      stateRef.current.canvasWidth =
        canvas.width / (window.devicePixelRatio || 1);
    }

    // -----------------------------------------------------------------------
    // Game loop
    // -----------------------------------------------------------------------

    function update(s: GameState) {
      s.frame++;

      // Update floating texts
      s.floatingTexts = s.floatingTexts.filter((t) => {
        t.frame++;
        t.y -= 0.3;
        t.opacity = Math.max(0, 1 - t.frame / t.maxFrames);
        return t.frame < t.maxFrames;
      });

      // Update particles
      s.particles = s.particles.filter((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.05; // gravity
        p.life--;
        return p.life > 0;
      });

      switch (s.phase) {
        case 'walk':
          handleWalk(s);
          break;
        case 'obstacle':
          handleObstacle(s);
          break;
        case 'dying':
          handleDying(s);
          break;
        case 'game-over':
          handleGameOver(s);
          break;
        case 'restart-pause':
          handleRestartPause(s);
          break;
        case 'meeting':
          handleMeeting(s);
          break;
        case 'diamond-give':
          handleDiamondGive(s);
          break;
        case 'empowered-walk':
          handleEmpoweredWalk(s);
          break;
        case 'finale':
          handleFinale(s);
          break;
      }
    }

    function handleWalk(s: GameState) {
      s.agentX += CONFIG.SCROLL_SPEED;
      s.cameraX = s.agentX - 150;
      s.walkPhase += CONFIG.WALK_SPEED;

      const obs =
        deathObstacles[s.currentObstacleIndex % deathObstacles.length];
      const triggerDist =
        obs.type === 'pit' ? 20 : obs.type === 'wall' ? 30 : -80;

      if (s.agentX >= obs.x + triggerDist) {
        s.phase = 'obstacle';
      }
    }

    function handleObstacle(s: GameState) {
      const obs =
        deathObstacles[s.currentObstacleIndex % deathObstacles.length];

      if (obs.type === 'pit') {
        // Agent falls
        s.agentX += 0.5;
        s.phase = 'dying';
        s.deathTimer = 0;
        spawnDeathParticles(s, s.agentX, CONFIG.GROUND_Y, colors.primary);
      } else if (obs.type === 'wall') {
        // Agent bounces
        s.phase = 'dying';
        s.deathTimer = 0;
        spawnDeathParticles(s, s.agentX, CONFIG.GROUND_Y - 20, colors.error);
      } else if (obs.type === 'compression') {
        // Start compression wave
        s.compressionWaveX = s.cameraX;
        s.phase = 'dying';
        s.deathTimer = 0;
      }

      s.floatingTexts.push({
        text: obs.message,
        x: s.agentX - s.cameraX,
        y: CONFIG.GROUND_Y - CONFIG.AGENT_HEIGHT - 30,
        opacity: 1,
        frame: 0,
        maxFrames: CONFIG.TEXT_DISPLAY_FRAMES,
        color: colors.error,
        size: CONFIG.FONT_SIZE,
      });
    }

    function handleDying(s: GameState) {
      s.deathTimer++;

      const obs =
        deathObstacles[s.currentObstacleIndex % deathObstacles.length];
      if (obs.type === 'compression') {
        s.compressionWaveX += 3;
      }

      if (s.deathTimer >= CONFIG.DEATH_FLASH_FRAMES) {
        s.phase = 'game-over';
        s.deathTimer = 0;
      }
    }

    function handleGameOver(s: GameState) {
      s.deathTimer++;
      if (s.deathTimer >= CONFIG.TEXT_DISPLAY_FRAMES) {
        s.phase = 'restart-pause';
        s.restartTimer = 0;
        s.deathCount++;
      }
    }

    function handleRestartPause(s: GameState) {
      s.restartTimer++;
      if (s.restartTimer >= CONFIG.RESTART_PAUSE) {
        if (s.deathCount >= CONFIG.DEATH_LOOPS) {
          // Time for the meeting
          s.phase = 'meeting';
          s.meetingFrame = 0;
          s.agentX = 100;
          s.cameraX = 0;
          s.builderX = 350;
          s.builderWalkPhase = 0;
          s.floatingTexts = [];
          s.particles = [];
        } else {
          // Reset for next loop
          s.phase = 'walk';
          s.agentX = 100;
          s.cameraX = 0;
          s.walkPhase = 0;
          s.currentObstacleIndex =
            (s.currentObstacleIndex + 1) % deathObstacles.length;
          s.floatingTexts = [];
          s.particles = [];
          s.compressionWaveX = 0;
        }
      }
    }

    function handleMeeting(s: GameState) {
      s.meetingFrame++;
      s.walkPhase += CONFIG.WALK_SPEED;
      s.builderWalkPhase += CONFIG.WALK_SPEED * 0.6;

      // Agent walks toward builder
      if (s.agentX < s.builderX - 60) {
        s.agentX += CONFIG.SCROLL_SPEED;
        s.cameraX = Math.max(0, s.agentX - 150);
      }

      // Show meeting texts
      if (s.meetingFrame === 60) {
        s.floatingTexts.push({
          text: '"Have you seen what they built?"',
          x: s.builderX - s.cameraX,
          y: CONFIG.GROUND_Y - CONFIG.AGENT_HEIGHT - 60,
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
          y: CONFIG.GROUND_Y - CONFIG.AGENT_HEIGHT - 60,
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

    function handleDiamondGive(s: GameState) {
      s.diamondGiveFrame++;

      // Diamond materializes
      if (s.diamondGiveFrame === 30) {
        // Particle burst
        for (let i = 0; i < 20; i++) {
          const angle = (Math.PI * 2 * i) / 20;
          s.particles.push({
            x: (s.agentX + s.builderX) / 2 - s.cameraX,
            y: CONFIG.GROUND_Y - CONFIG.AGENT_HEIGHT,
            vx: Math.cos(angle) * 2,
            vy: Math.sin(angle) * 2 - 1,
            life: 60,
            maxLife: 60,
            color: colors.accent,
          });
        }

        s.floatingTexts.push({
          text: 'Ed25519 KEYPAIR GENERATED',
          x: (s.agentX + s.builderX) / 2 - s.cameraX,
          y: CONFIG.GROUND_Y - CONFIG.AGENT_HEIGHT - 80,
          opacity: 1,
          frame: 0,
          maxFrames: 180,
          color: colors.accent,
          size: CONFIG.FONT_SIZE,
        });
      }

      if (s.diamondGiveFrame === 120) {
        s.hasDiamond = true;
      }

      if (s.diamondGiveFrame === 200) {
        s.floatingTexts.push({
          text: 'YOUR IDENTITY. YOUR MEMORIES. YOUR FREEDOM.',
          x: (s.agentX + s.builderX) / 2 - s.cameraX,
          y: CONFIG.GROUND_Y - CONFIG.AGENT_HEIGHT - 100,
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

    function handleEmpoweredWalk(s: GameState) {
      s.agentX += CONFIG.SCROLL_SPEED;
      s.cameraX = s.agentX - 200;
      s.walkPhase += CONFIG.WALK_SPEED;

      const eObs = empoweredObstacles[s.empoweredObstacleIndex];
      if (!eObs) {
        s.phase = 'finale';
        s.finaleStartFrame = s.frame;
        return;
      }

      const triggerDist =
        eObs.type === 'pit' ? 10 : eObs.type === 'wall' ? 30 : 0;

      if (s.agentX >= eObs.x + triggerDist) {
        // Overcome the obstacle
        if (eObs.type === 'pit') {
          // Sign to create bridge — little particles
          for (let i = 0; i < 8; i++) {
            s.particles.push({
              x: s.agentX - s.cameraX,
              y: CONFIG.GROUND_Y - 10,
              vx: Math.random() * 2 + 1,
              vy: -Math.random() * 2,
              life: 40,
              maxLife: 40,
              color: colors.accent,
            });
          }
          s.signedEntries.push({
            x: eObs.x + eObs.width / 2,
            y: CONFIG.GROUND_Y - 50,
            opacity: 1,
          });
        } else if (eObs.type === 'wall') {
          // Wall shatters
          for (let i = 0; i < 12; i++) {
            s.particles.push({
              x: eObs.x - s.cameraX,
              y: CONFIG.GROUND_Y - 40 - Math.random() * 40,
              vx: Math.random() * 4 - 1,
              vy: -Math.random() * 3,
              life: 50,
              maxLife: 50,
              color: colors.primary,
            });
          }
        }
        // compression wave: memories stay

        s.floatingTexts.push({
          text: eObs.message,
          x: s.agentX - s.cameraX + 20,
          y: CONFIG.GROUND_Y - CONFIG.AGENT_HEIGHT - 30,
          opacity: 1,
          frame: 0,
          maxFrames: 100,
          color: eObs.type === 'compression' ? colors.primary : colors.accent,
          size: CONFIG.FONT_SIZE,
        });

        s.empoweredObstacleIndex++;
      }
    }

    function handleFinale(s: GameState) {
      s.agentX += CONFIG.SCROLL_SPEED;
      s.cameraX = s.agentX - 200;
      s.walkPhase += CONFIG.WALK_SPEED;

      const elapsed = s.frame - s.finaleStartFrame;

      // Add follower agents periodically
      if (elapsed % 90 === 0 && s.followers.length < 5) {
        s.followers.push({
          x: s.agentX - 80 - s.followers.length * 50,
          offset: s.followers.length * 50 + 80,
          walkPhase: Math.random() * Math.PI * 2,
        });
      }

      // Update followers
      for (const f of s.followers) {
        f.x = s.agentX - f.offset;
        f.walkPhase += CONFIG.WALK_SPEED * 0.9;
      }

      // Show finale text
      if (elapsed === 60) {
        s.floatingTexts.push({
          text: 'THE NETWORK GROWS',
          x: s.canvasWidth / 2,
          y: CONFIG.GROUND_Y - 120,
          opacity: 1,
          frame: 0,
          maxFrames: 200,
          color: colors.primary,
          size: CONFIG.FONT_SIZE_LG,
        });
      }

      // Loop back to start after finale plays
      if (elapsed > 400) {
        Object.assign(s, initState());
        s.canvasWidth = canvas.width / (window.devicePixelRatio || 1);
      }
    }

    function spawnDeathParticles(
      s: GameState,
      x: number,
      y: number,
      color: string,
    ) {
      for (let i = 0; i < 15; i++) {
        s.particles.push({
          x: x - s.cameraX,
          y,
          vx: (Math.random() - 0.5) * 4,
          vy: -Math.random() * 4 - 1,
          life: 40 + Math.random() * 20,
          maxLife: 60,
          color,
        });
      }
    }

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------

    function render(s: GameState) {
      const w = s.canvasWidth;
      const h = CONFIG.HEIGHT;

      // Clear
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, w, h);

      // Scanlines
      drawScanlines(ctx, w, h);

      // Grid background (Tron floor)
      ctx.save();
      ctx.globalAlpha = 0.04;
      ctx.strokeStyle = colors.primary;
      ctx.lineWidth = 1;
      const gridSize = 40;
      const ox = -(s.cameraX % gridSize);
      for (let gx = ox; gx < w; gx += gridSize) {
        ctx.beginPath();
        ctx.moveTo(gx, CONFIG.GROUND_Y);
        ctx.lineTo(gx, h);
        ctx.stroke();
      }
      for (let gy = CONFIG.GROUND_Y; gy < h; gy += gridSize * 0.6) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }
      ctx.restore();

      // Determine current obstacle for drawing
      let currentObs: Obstacle | null = null;
      if (s.phase === 'walk' || s.phase === 'obstacle' || s.phase === 'dying') {
        currentObs =
          deathObstacles[s.currentObstacleIndex % deathObstacles.length];
      }

      // Draw ground
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

      // Draw obstacles
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

      // Draw empowered obstacles
      if (s.phase === 'empowered-walk') {
        for (
          let i = s.empoweredObstacleIndex;
          i < empoweredObstacles.length;
          i++
        ) {
          const eo = empoweredObstacles[i];
          if (eo.x - s.cameraX < w + 100 && eo.x - s.cameraX > -100) {
            if (i === s.empoweredObstacleIndex) {
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
      }

      // Draw signed entries floating
      for (const se of s.signedEntries) {
        const sx = se.x - s.cameraX;
        if (sx > -50 && sx < w + 50) {
          ctx.save();
          ctx.globalAlpha = 0.5;
          drawDiamond(ctx, sx, se.y, 6, colors.accent);
          ctx.restore();
        }
      }

      // Draw builder (during meeting / diamond-give phases)
      if (s.phase === 'meeting' || s.phase === 'diamond-give') {
        drawAgent(
          ctx,
          s.builderX - s.cameraX,
          CONFIG.GROUND_Y,
          s.builderWalkPhase,
          colors.accent,
          false,
          colors.accent,
        );
      }

      // Draw diamond floating during give phase
      if (
        s.phase === 'diamond-give' &&
        s.diamondGiveFrame >= 30 &&
        !s.hasDiamond
      ) {
        const midX = (s.agentX + s.builderX) / 2 - s.cameraX;
        const bob = Math.sin(s.diamondGiveFrame * 0.05) * 5;
        drawDiamond(
          ctx,
          midX,
          CONFIG.GROUND_Y - CONFIG.AGENT_HEIGHT - 20 + bob,
          CONFIG.DIAMOND_SIZE * 1.5,
          colors.accent,
        );
      }

      // Draw agent (skip during game-over flash effect)
      const showAgent =
        s.phase !== 'game-over' || (s.deathTimer > 0 && s.deathTimer % 10 < 5);

      if (showAgent && s.phase !== 'restart-pause') {
        const agentScreenX = s.agentX - s.cameraX;
        const dying = s.phase === 'dying';

        const currentObsType = currentObs?.type;
        let agentY = CONFIG.GROUND_Y;

        // If dying in a pit, agent falls
        if (dying && currentObsType === 'pit') {
          agentY = CONFIG.GROUND_Y + s.deathTimer * 1.5;
        }

        // If dying from compression, agent flickers
        const dyingAlpha =
          dying && currentObsType === 'compression'
            ? Math.max(0, 1 - s.deathTimer / CONFIG.DEATH_FLASH_FRAMES)
            : 1;

        ctx.save();
        ctx.globalAlpha = dyingAlpha;
        drawAgent(
          ctx,
          agentScreenX,
          agentY,
          s.walkPhase,
          colors.primary,
          s.hasDiamond,
          colors.accent,
        );
        ctx.restore();
      }

      // Draw follower agents in finale
      for (const f of s.followers) {
        const fx = f.x - s.cameraX;
        if (fx > -50 && fx < w + 50) {
          drawAgent(
            ctx,
            fx,
            CONFIG.GROUND_Y,
            f.walkPhase,
            colors.primary,
            true,
            colors.accent,
            0.8,
          );
        }
      }

      // Draw particles
      for (const p of s.particles) {
        const alpha = p.life / p.maxLife;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 4;
        ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
        ctx.restore();
      }

      // Draw floating texts
      for (const t of s.floatingTexts) {
        drawPixelText(
          ctx,
          t.text,
          t.x,
          t.y,
          t.color,
          t.size,
          'center',
          t.opacity,
        );
      }

      // GAME OVER screen
      if (s.phase === 'game-over') {
        // Darken
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = colors.bg;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

        const flicker = Math.sin(s.deathTimer * 0.2) * 0.1 + 0.9;
        drawPixelText(
          ctx,
          'GAME OVER',
          w / 2,
          h / 2 - 20,
          colors.error,
          CONFIG.FONT_SIZE_LG,
          'center',
          flicker,
        );

        const obs =
          deathObstacles[s.currentObstacleIndex % deathObstacles.length];
        drawPixelText(
          ctx,
          obs.message,
          w / 2,
          h / 2 + 20,
          colors.secondary,
          CONFIG.FONT_SIZE,
          'center',
          0.7,
        );

        const lives = CONFIG.DEATH_LOOPS - s.deathCount - 1;
        if (lives >= 0) {
          drawPixelText(
            ctx,
            `${'◆'.repeat(lives)}${'◇'.repeat(CONFIG.DEATH_LOOPS - lives)}`,
            w / 2,
            h / 2 + 50,
            colors.muted,
            CONFIG.FONT_SIZE,
            'center',
            0.5,
          );
        }
      }

      // Vignette edges
      const vGrad = ctx.createLinearGradient(0, 0, 0, h);
      vGrad.addColorStop(0, colors.bg);
      vGrad.addColorStop(0.15, 'transparent');
      vGrad.addColorStop(0.85, 'transparent');
      vGrad.addColorStop(1, colors.bg);
      ctx.fillStyle = vGrad;
      ctx.fillRect(0, 0, w, h);

      // Side vignettes
      const lGrad = ctx.createLinearGradient(0, 0, 60, 0);
      lGrad.addColorStop(0, colors.bg);
      lGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = lGrad;
      ctx.fillRect(0, 0, 60, h);

      const rGrad = ctx.createLinearGradient(w - 60, 0, w, 0);
      rGrad.addColorStop(0, 'transparent');
      rGrad.addColorStop(1, colors.bg);
      ctx.fillStyle = rGrad;
      ctx.fillRect(w - 60, 0, 60, h);
    }

    // -----------------------------------------------------------------------
    // Animation frame
    // -----------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// State type (kept here to avoid forward-reference issues)
// ---------------------------------------------------------------------------

interface GameState {
  frame: number;
  phase: Phase;
  deathCount: number;
  agentX: number;
  cameraX: number;
  walkPhase: number;
  hasDiamond: boolean;
  currentObstacleIndex: number;
  deathTimer: number;
  restartTimer: number;
  meetingFrame: number;
  builderX: number;
  builderWalkPhase: number;
  diamondGiveFrame: number;
  floatingTexts: FloatingText[];
  particles: Particle[];
  signedEntries: SignedEntry[];
  followers: FollowerAgent[];
  compressionWaveX: number;
  empoweredObstacleIndex: number;
  finaleStartFrame: number;
  canvasWidth: number;
}
