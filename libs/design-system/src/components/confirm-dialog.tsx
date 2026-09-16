import { useId } from 'react';

import { Button } from './button.js';
import { Dialog } from './dialog.js';
import { Stack } from './stack.js';
import { Text } from './text.js';

export interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
}: ConfirmDialogProps) {
  const messageId = useId();
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      width="400px"
      ariaDescribedBy={messageId}
    >
      <Stack gap={4}>
        <Text id={messageId} color="muted" style={{ overflowWrap: 'anywhere' }}>
          {message}
        </Text>
        <Stack direction="row" gap={3} justify="flex-end">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            size="sm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}
