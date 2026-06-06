import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { useTheme } from '../hooks.js';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  width?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  closeLabel?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  width = '480px',
  ariaLabel,
  ariaDescribedBy,
  closeLabel = 'Close',
}: DialogProps) {
  const theme = useTheme();
  const ref = useRef<HTMLDialogElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const closingFromPropsRef = useRef(false);
  const titleId = useId();
  const [rendered, setRendered] = useState(open);

  useEffect(() => {
    if (open) setRendered(true);
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      previouslyFocusedRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      // showModal may not be available in test environments (jsdom)
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      }
    } else if (!open && dialog.open) {
      closingFromPropsRef.current = true;
      dialog.close();
      previouslyFocusedRef.current?.focus();
      previouslyFocusedRef.current = null;
      setRendered(false);
    } else if (!open) {
      setRendered(false);
    }
  }, [open, rendered]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClose = () => {
      if (closingFromPropsRef.current) {
        closingFromPropsRef.current = false;
        return;
      }
      onClose();
    };
    const handleCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('cancel', handleCancel);
    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('cancel', handleCancel);
    };
  }, [onClose]);

  if (!rendered) return null;

  return (
    <dialog
      ref={ref}
      aria-label={title ? undefined : ariaLabel}
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={ariaDescribedBy}
      aria-modal="true"
      style={{
        position: 'fixed',
        maxWidth: width,
        width: '90vw',
        padding: 0,
        border: `1px solid ${theme.color.border.DEFAULT}`,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.color.bg.elevated,
        color: theme.color.text.DEFAULT,
        boxShadow: theme.shadow.lg,
      }}
    >
      <style>{`dialog::backdrop { background: rgba(0,0,0,0.6); }`}</style>
      <div
        style={{
          padding: theme.spacing[5],
          display: 'flex',
          flexDirection: 'column',
          gap: theme.spacing[4],
        }}
      >
        {title && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span
              id={titleId}
              style={{
                fontSize: theme.font.size.lg,
                fontWeight: theme.font.weight.semibold,
              }}
            >
              {title}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              style={{
                background: 'none',
                border: 'none',
                color: theme.color.text.muted,
                cursor: 'pointer',
                fontSize: theme.font.size.lg,
                padding: theme.spacing[1],
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
        )}
        {children}
      </div>
    </dialog>
  );
}
