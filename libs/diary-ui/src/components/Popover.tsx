import { Button } from '@themoltnet/design-system';
import { useTheme } from '@themoltnet/design-system';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

export interface PopoverProps {
  label: ReactNode;
  ariaLabel?: string;
  badge?: number;
  disabled?: boolean;
  children: (ctx: { close: () => void }) => ReactNode;
}

export function Popover({
  label,
  ariaLabel,
  badge,
  disabled,
  children,
}: PopoverProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', display: 'inline-block' }}
    >
      <Button
        type="button"
        variant={open ? 'secondary' : 'ghost'}
        size="sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {label}
          {typeof badge === 'number' && badge > 0 && (
            <span
              aria-hidden="true"
              style={{
                minWidth: 18,
                padding: '0 6px',
                borderRadius: theme.radius.full,
                background: theme.color.primary.muted,
                color: theme.color.primary.DEFAULT,
                fontSize: 11,
                fontWeight: theme.font.weight.medium,
                lineHeight: '18px',
                textAlign: 'center',
              }}
            >
              {badge}
            </span>
          )}
          <span style={{ fontSize: 10, opacity: 0.5 }}>▾</span>
        </span>
      </Button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 20,
            minWidth: 280,
            maxWidth: 360,
            padding: theme.spacing[4],
            borderRadius: theme.radius.md,
            border: `1px solid ${theme.color.border.DEFAULT}`,
            background: theme.color.bg.elevated,
            boxShadow:
              '0 1px 0 rgba(255,255,255,0.04) inset, 0 12px 32px rgba(0,0,0,0.35)',
            animation: reduceMotion
              ? undefined
              : `diary-ui-popover-in 160ms ${theme.transition.fast.includes('cubic') ? theme.transition.fast.split(' ').slice(1).join(' ') : 'ease-out'}`,
            transformOrigin: 'top left',
          }}
        >
          <style>{`
            @keyframes diary-ui-popover-in {
              from { opacity: 0; transform: translateY(-2px) scale(0.985); }
              to   { opacity: 1; transform: translateY(0) scale(1); }
            }
          `}</style>
          {children({ close: () => setOpen(false) })}
        </div>
      )}
    </div>
  );
}
