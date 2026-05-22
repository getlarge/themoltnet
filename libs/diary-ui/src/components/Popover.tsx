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
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        style={{
          padding: '6px 10px',
          borderRadius: theme.radius.md,
          border: `1px solid ${theme.color.border.DEFAULT}`,
          background: theme.color.bg.elevated,
          color: theme.color.text.DEFAULT,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          font: 'inherit',
        }}
      >
        {label}
        {typeof badge === 'number' && badge > 0 && (
          <span
            aria-hidden="true"
            style={{
              marginLeft: 6,
              padding: '0 6px',
              borderRadius: theme.radius.full,
              background: theme.color.primary.muted,
              color: theme.color.primary.DEFAULT,
              fontSize: 11,
            }}
          >
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 20,
            minWidth: 260,
            maxWidth: 360,
            padding: theme.spacing[3],
            borderRadius: theme.radius.md,
            border: `1px solid ${theme.color.border.DEFAULT}`,
            background: theme.color.bg.elevated,
            boxShadow: '0 10px 32px rgba(0,0,0,0.35)',
          }}
        >
          {children({ close: () => setOpen(false) })}
        </div>
      )}
    </div>
  );
}
