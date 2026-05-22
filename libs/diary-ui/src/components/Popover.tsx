import { Button, useTheme } from '@themoltnet/design-system';
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
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  const labelId = useId();
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

  // Focus management: move focus into the panel on open, return to trigger on
  // close. This is lighter than a full focus trap (Tab still escapes the panel)
  // and matches the WAI-ARIA non-modal "group" pattern. role="dialog" would
  // require aria-modal + a trap, which is overkill for a filter facet.
  useEffect(() => {
    if (open) {
      // Defer to next frame so the panel exists in the DOM.
      const handle = window.requestAnimationFrame(() => {
        const first = panelRef.current?.querySelector<HTMLElement>(
          'input, button, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        (first ?? panelRef.current)?.focus();
      });
      return () => window.cancelAnimationFrame(handle);
    }
    // The trigger is the first <button> child of the container (it precedes
    // the panel in DOM order). design-system's Button doesn't forward refs in
    // its public type, so we locate it via the container instead.
    const trigger =
      containerRef.current?.querySelector<HTMLButtonElement>(':scope > button');
    trigger?.focus();
    return undefined;
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
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span id={labelId}>{label}</span>
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
          ref={panelRef}
          role="group"
          aria-labelledby={labelId}
          tabIndex={-1}
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
              : 'diary-ui-popover-in 160ms ease-out',
            transformOrigin: 'top left',
            outline: 'none',
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
