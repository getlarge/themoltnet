import { type ReactNode, useEffect, useRef } from 'react';

import { useTheme } from '../hooks.js';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  width?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  width = '480px',
}: DialogProps) {
  const theme = useTheme();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      // showModal may not be available in test environments (jsdom)
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      }
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClose = () => onClose();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
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
              aria-label="Close"
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
