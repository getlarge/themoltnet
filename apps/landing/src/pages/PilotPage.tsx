import { useCallback, useEffect, useRef, useState } from 'react';

type Mode = 'helicopter' | 'hiker';

const MOUNTAINS = [
  { x: 100, height: 200, width: 180 },
  { x: 300, height: 280, width: 220 },
  { x: 550, height: 180, width: 160 },
  { x: 750, height: 320, width: 240 },
  { x: 1000, height: 220, width: 200 },
];

const TREES = [
  { x: 80, size: 30 },
  { x: 200, size: 25 },
  { x: 420, size: 35 },
  { x: 600, size: 28 },
  { x: 850, size: 32 },
  { x: 1100, size: 26 },
];

const CLOUDS = [
  { x: 120, y: 80, size: 60 },
  { x: 350, y: 50, size: 80 },
  { x: 600, y: 100, size: 50 },
  { x: 850, y: 60, size: 70 },
  { x: 1050, y: 90, size: 55 },
];

const STARS_COUNT = 30;

function randomStars() {
  return Array.from({ length: STARS_COUNT }, () => ({
    x: Math.random() * 100,
    y: Math.random() * 40,
    size: Math.random() * 2 + 1,
    twinkle: Math.random() * 2 + 1,
  }));
}

export function PilotPage() {
  const [mode, setMode] = useState<Mode>('helicopter');
  const [altitude, setAltitude] = useState(50);
  const [speed, setSpeed] = useState(0);
  const [fuel, setFuel] = useState(100);
  const [steps, setSteps] = useState(0);
  const [distance, setDistance] = useState(0);
  const [engineOn, setEngineOn] = useState(false);
  const [bladeAngle, setBladeAngle] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [isNight, setIsNight] = useState(false);
  const [stars] = useState(randomStars);
  const [badges, setBadges] = useState<string[]>([]);
  const [showBadge, setShowBadge] = useState<string | null>(null);
  const [horn, setHorn] = useState(false);
  const animRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const earnBadge = useCallback(
    (badge: string) => {
      if (!badges.includes(badge)) {
        setBadges((prev) => [...prev, badge]);
        setShowBadge(badge);
        setTimeout(() => setShowBadge(null), 2500);
      }
    },
    [badges],
  );

  // Blade animation
  useEffect(() => {
    if (!engineOn) return;
    let raf: number;
    const spin = () => {
      setBladeAngle((a) => (a + 15 + speed * 2) % 360);
      raf = requestAnimationFrame(spin);
    };
    raf = requestAnimationFrame(spin);
    return () => cancelAnimationFrame(raf);
  }, [engineOn, speed]);

  // Landscape scrolling
  useEffect(() => {
    if (speed <= 0) return;
    let raf: number;
    const scroll = () => {
      setScrollOffset((o) => o + speed * 0.5);
      setDistance((d) => {
        const next = d + speed * 0.02;
        if (next >= 10 && !badges.includes('Explorer'))
          earnBadge('Explorer');
        if (next >= 50 && !badges.includes('Long Haul'))
          earnBadge('Long Haul');
        return next;
      });
      raf = requestAnimationFrame(scroll);
    };
    raf = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(raf);
  }, [speed, badges, earnBadge]);

  // Fuel consumption
  useEffect(() => {
    if (!engineOn || mode !== 'helicopter') return;
    const interval = setInterval(() => {
      setFuel((f) => {
        const next = Math.max(0, f - 0.3);
        if (next <= 0) {
          setEngineOn(false);
          setSpeed(0);
        }
        return next;
      });
    }, 500);
    return () => clearInterval(interval);
  }, [engineOn, mode]);

  // Badge checks
  useEffect(() => {
    if (altitude >= 95 && !badges.includes('Sky High'))
      earnBadge('Sky High');
    if (steps >= 100 && !badges.includes('Super Hiker'))
      earnBadge('Super Hiker');
    if (speed >= 9 && !badges.includes('Speed Demon'))
      earnBadge('Speed Demon');
  }, [altitude, steps, speed, badges, earnBadge]);

  const playSound = useCallback(
    (freq: number, duration: number, type: OscillatorType = 'square') => {
      try {
        if (!audioCtxRef.current)
          audioCtxRef.current = new AudioContext();
        const ctx = audioCtxRef.current;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.value = 0.15;
        gain.gain.exponentialRampToValueAtTime(
          0.01,
          ctx.currentTime + duration,
        );
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
      } catch {
        // Audio not available
      }
    },
    [],
  );

  const handleUp = () => {
    if (mode === 'helicopter' && engineOn) {
      setAltitude((a) => Math.min(100, a + 5));
      playSound(600, 0.15, 'sine');
    }
    if (mode === 'hiker') {
      setSteps((s) => s + 1);
      setSpeed(3);
      playSound(400, 0.1, 'sine');
      cancelAnimationFrame(animRef.current);
      animRef.current = requestAnimationFrame(() => {
        setTimeout(() => setSpeed(0), 800);
      });
    }
  };

  const handleDown = () => {
    if (mode === 'helicopter' && engineOn) {
      setAltitude((a) => Math.max(0, a - 5));
      playSound(300, 0.15, 'sine');
    }
  };

  const handleSpeedUp = () => {
    if (mode === 'helicopter' && engineOn) {
      setSpeed((s) => Math.min(10, s + 1));
      playSound(500, 0.1);
    }
  };

  const handleSlowDown = () => {
    if (mode === 'helicopter' && engineOn) {
      setSpeed((s) => Math.max(0, s - 1));
      playSound(250, 0.1);
    }
  };

  const handleEngine = () => {
    if (fuel <= 0 && !engineOn) {
      setFuel(100);
    }
    setEngineOn((e) => !e);
    if (!engineOn) {
      playSound(200, 0.5, 'sawtooth');
      if (!badges.includes('First Flight')) earnBadge('First Flight');
    } else {
      setSpeed(0);
    }
  };

  const handleHorn = () => {
    setHorn(true);
    playSound(800, 0.3, 'square');
    setTimeout(() => {
      playSound(600, 0.3, 'square');
    }, 300);
    setTimeout(() => setHorn(false), 600);
    if (!badges.includes('Honk Honk!')) earnBadge('Honk Honk!');
  };

  const handleRefuel = () => {
    setFuel(100);
    playSound(1000, 0.2, 'sine');
  };

  const skyColor = isNight
    ? 'linear-gradient(180deg, #0a0a2e 0%, #1a1a4e 40%, #2a1a3e 100%)'
    : mode === 'helicopter'
      ? `linear-gradient(180deg, #87CEEB ${100 - altitude}%, #b8e6ff 100%)`
      : 'linear-gradient(180deg, #87CEEB 0%, #b8e6ff 60%, #90EE90 100%)';

  return (
    <div
      style={{
        minHeight: '100vh',
        background: skyColor,
        fontFamily: '"Comic Sans MS", "Chalkboard SE", cursive, sans-serif',
        overflow: 'hidden',
        position: 'relative',
        userSelect: 'none',
        transition: 'background 1s ease',
      }}
    >
      {/* Stars (night mode) */}
      {isNight &&
        stars.map((star, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: star.size,
              height: star.size,
              background: '#fff',
              borderRadius: '50%',
              animation: `twinkle ${star.twinkle}s ease-in-out infinite alternate`,
            }}
          />
        ))}

      {/* Mode Switcher */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 12,
          zIndex: 20,
        }}
      >
        <BigButton
          onClick={() => {
            setMode('helicopter');
            setSpeed(0);
          }}
          active={mode === 'helicopter'}
          color="#ff6b35"
        >
          helicopter
        </BigButton>
        <BigButton
          onClick={() => {
            setMode('hiker');
            setEngineOn(false);
            setSpeed(0);
          }}
          active={mode === 'hiker'}
          color="#4CAF50"
        >
          hiker
        </BigButton>
        <BigButton
          onClick={() => setIsNight((n) => !n)}
          active={isNight}
          color="#6a5acd"
        >
          {isNight ? 'day' : 'night'}
        </BigButton>
      </div>

      {/* Clouds */}
      {CLOUDS.map((cloud, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: ((cloud.x - scrollOffset * 0.3) % 1200) - 100,
            top:
              mode === 'helicopter'
                ? cloud.y + altitude * 1.5
                : cloud.y,
            width: cloud.size,
            height: cloud.size * 0.5,
            background: isNight
              ? 'rgba(200,200,255,0.15)'
              : 'rgba(255,255,255,0.9)',
            borderRadius: '50%',
            boxShadow: isNight
              ? `${cloud.size * 0.3}px ${cloud.size * 0.1}px 0 rgba(200,200,255,0.1)`
              : `${cloud.size * 0.3}px ${cloud.size * 0.1}px 0 rgba(255,255,255,0.8)`,
            transition: 'top 0.3s ease',
          }}
        />
      ))}

      {/* Mountains */}
      <svg
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100%',
          height: '40%',
          overflow: 'visible',
        }}
        viewBox="0 0 1200 400"
        preserveAspectRatio="none"
      >
        {MOUNTAINS.map((m, i) => {
          const mx = ((m.x - scrollOffset * 0.2) % 1400) - 200;
          return (
            <polygon
              key={i}
              points={`${mx},400 ${mx + m.width / 2},${400 - m.height} ${mx + m.width},400`}
              fill={
                isNight
                  ? `hsl(${240 + i * 10}, 20%, ${15 + i * 3}%)`
                  : `hsl(${120 + i * 15}, ${30 + i * 5}%, ${35 + i * 8}%)`
              }
            />
          );
        })}
        {/* Snow caps */}
        {MOUNTAINS.map((m, i) => {
          const mx = ((m.x - scrollOffset * 0.2) % 1400) - 200;
          if (m.height < 250) return null;
          return (
            <polygon
              key={`snow-${i}`}
              points={`${mx + m.width * 0.35},${400 - m.height + 30} ${mx + m.width / 2},${400 - m.height} ${mx + m.width * 0.65},${400 - m.height + 30}`}
              fill={isNight ? '#c8c8ff' : '#fff'}
            />
          );
        })}
      </svg>

      {/* Trees */}
      {TREES.map((tree, i) => {
        const tx = ((tree.x - scrollOffset * 0.4) % 1300) - 100;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              bottom: `${5 + (i % 3) * 2}%`,
              left: tx,
              fontSize: tree.size,
              transition: 'bottom 0.3s',
            }}
          >
            🌲
          </div>
        );
      })}

      {/* Ground */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '8%',
          background: isNight
            ? 'linear-gradient(180deg, #1a3a1a, #0a2a0a)'
            : 'linear-gradient(180deg, #4CAF50, #2E7D32)',
          borderTop: isNight
            ? '3px solid #2a4a2a'
            : '3px solid #66BB6A',
        }}
      />

      {/* Helicopter */}
      {mode === 'helicopter' && (
        <div
          style={{
            position: 'absolute',
            left: '15%',
            bottom: `${10 + altitude * 0.7}%`,
            transition: 'bottom 0.3s ease',
            fontSize: 64,
            filter: horn
              ? 'drop-shadow(0 0 20px #ff0)'
              : 'drop-shadow(2px 2px 4px rgba(0,0,0,0.3))',
          }}
        >
          {/* Rotor */}
          <div
            style={{
              position: 'absolute',
              top: -18,
              left: '50%',
              transform: `translateX(-50%) rotate(${bladeAngle}deg)`,
              width: 80,
              height: 6,
              background:
                'linear-gradient(90deg, #666, #999, #666)',
              borderRadius: 3,
              opacity: engineOn ? 1 : 0.4,
            }}
          />
          🚁
        </div>
      )}

      {/* Hiker */}
      {mode === 'hiker' && (
        <div
          style={{
            position: 'absolute',
            left: '20%',
            bottom: '10%',
            fontSize: 56,
            animation:
              speed > 0 ? 'bounce 0.3s ease infinite' : 'none',
            filter: 'drop-shadow(2px 2px 4px rgba(0,0,0,0.3))',
          }}
        >
          🧗
        </div>
      )}

      {/* Badge notification */}
      {showBadge && (
        <div
          style={{
            position: 'fixed',
            top: '30%',
            left: '50%',
            transform: 'translateX(-50%)',
            background:
              'linear-gradient(135deg, #FFD700, #FFA500)',
            color: '#333',
            padding: '20px 40px',
            borderRadius: 20,
            fontSize: 28,
            fontWeight: 'bold',
            zIndex: 100,
            animation: 'popIn 0.5s ease',
            boxShadow: '0 8px 32px rgba(255,165,0,0.5)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 48 }}>⭐</div>
          NEW BADGE!
          <br />
          {showBadge}
        </div>
      )}

      {/* Dashboard */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: isNight
            ? 'linear-gradient(180deg, rgba(20,20,50,0.95), rgba(10,10,30,0.98))'
            : 'linear-gradient(180deg, rgba(40,40,60,0.95), rgba(20,20,30,0.98))',
          padding: '12px 20px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          flexWrap: 'wrap',
          zIndex: 30,
          borderTop: '3px solid #ff6b35',
        }}
      >
        {mode === 'helicopter' && (
          <>
            <Gauge
              label="ALTITUDE"
              value={altitude}
              max={100}
              unit="m"
              color="#00bcd4"
            />
            <Gauge
              label="SPEED"
              value={speed}
              max={10}
              unit="km/h"
              color="#ff9800"
            />
            <Gauge
              label="FUEL"
              value={fuel}
              max={100}
              unit="%"
              color={fuel < 20 ? '#f44336' : '#4CAF50'}
            />
            <Gauge
              label="DISTANCE"
              value={Math.round(distance)}
              max={999}
              unit="km"
              color="#9c27b0"
            />

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <ControlButton onClick={handleUp} color="#00bcd4">
                UP
              </ControlButton>
              <ControlButton onClick={handleDown} color="#00bcd4">
                DOWN
              </ControlButton>
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <ControlButton onClick={handleSpeedUp} color="#ff9800">
                FASTER
              </ControlButton>
              <ControlButton
                onClick={handleSlowDown}
                color="#ff9800"
              >
                SLOWER
              </ControlButton>
            </div>
            <ControlButton
              onClick={handleEngine}
              color={engineOn ? '#f44336' : '#4CAF50'}
              big
            >
              {engineOn ? 'STOP' : 'START'}
            </ControlButton>
            {fuel < 30 && (
              <ControlButton onClick={handleRefuel} color="#ff9800" big>
                REFUEL
              </ControlButton>
            )}
            <ControlButton onClick={handleHorn} color="#FFD700" big>
              HONK!
            </ControlButton>
          </>
        )}

        {mode === 'hiker' && (
          <>
            <Gauge
              label="STEPS"
              value={steps}
              max={1000}
              unit=""
              color="#4CAF50"
            />
            <Gauge
              label="DISTANCE"
              value={Math.round(distance)}
              max={999}
              unit="km"
              color="#9c27b0"
            />
            <div
              style={{
                display: 'flex',
                gap: 8,
              }}
            >
              <ControlButton onClick={handleUp} color="#4CAF50" big>
                WALK!
              </ControlButton>
              <ControlButton onClick={handleHorn} color="#FFD700" big>
                YODEL!
              </ControlButton>
            </div>
          </>
        )}

        {/* Badges display */}
        {badges.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: 6,
              alignItems: 'center',
              marginLeft: 8,
            }}
          >
            {badges.map((b) => (
              <span
                key={b}
                title={b}
                style={{
                  background: '#FFD700',
                  color: '#333',
                  padding: '2px 8px',
                  borderRadius: 10,
                  fontSize: 11,
                  fontWeight: 'bold',
                }}
              >
                ⭐ {b}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* CSS animations */}
      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-15px); }
        }
        @keyframes popIn {
          0% { transform: translateX(-50%) scale(0); }
          60% { transform: translateX(-50%) scale(1.2); }
          100% { transform: translateX(-50%) scale(1); }
        }
        @keyframes twinkle {
          0% { opacity: 0.3; }
          100% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function Gauge({
  label,
  value,
  max,
  unit,
  color,
}: {
  label: string;
  value: number;
  max: number;
  unit: string;
  color: string;
}) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ textAlign: 'center', minWidth: 80 }}>
      <div
        style={{
          color: '#aaa',
          fontSize: 10,
          fontWeight: 'bold',
          letterSpacing: 1,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          color,
          fontSize: 26,
          fontWeight: 'bold',
          lineHeight: 1,
        }}
      >
        {Math.round(value)}
        <span style={{ fontSize: 12, color: '#888' }}>{unit}</span>
      </div>
      <div
        style={{
          width: '100%',
          height: 6,
          background: '#333',
          borderRadius: 3,
          marginTop: 4,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: color,
            borderRadius: 3,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}

function ControlButton({
  children,
  onClick,
  color,
  big,
}: {
  children: React.ReactNode;
  onClick: () => void;
  color: string;
  big?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: color,
        color: '#fff',
        border: 'none',
        borderRadius: big ? 16 : 10,
        padding: big ? '12px 24px' : '6px 14px',
        fontSize: big ? 18 : 13,
        fontWeight: 'bold',
        cursor: 'pointer',
        fontFamily:
          '"Comic Sans MS", "Chalkboard SE", cursive, sans-serif',
        boxShadow: `0 4px 12px ${color}66`,
        textTransform: 'uppercase',
        letterSpacing: 1,
        transition: 'transform 0.1s, box-shadow 0.1s',
      }}
      onMouseDown={(e) =>
        ((e.target as HTMLElement).style.transform = 'scale(0.93)')
      }
      onMouseUp={(e) =>
        ((e.target as HTMLElement).style.transform = 'scale(1)')
      }
      onMouseLeave={(e) =>
        ((e.target as HTMLElement).style.transform = 'scale(1)')
      }
    >
      {children}
    </button>
  );
}

function BigButton({
  children,
  onClick,
  active,
  color,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  color: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? color : 'rgba(255,255,255,0.2)',
        color: '#fff',
        border: active ? `3px solid ${color}` : '3px solid transparent',
        borderRadius: 20,
        padding: '8px 20px',
        fontSize: 16,
        fontWeight: 'bold',
        cursor: 'pointer',
        fontFamily:
          '"Comic Sans MS", "Chalkboard SE", cursive, sans-serif',
        textTransform: 'uppercase',
        letterSpacing: 1,
        transition: 'all 0.2s',
        boxShadow: active
          ? `0 4px 16px ${color}88`
          : '0 2px 8px rgba(0,0,0,0.2)',
      }}
    >
      {children}
    </button>
  );
}
