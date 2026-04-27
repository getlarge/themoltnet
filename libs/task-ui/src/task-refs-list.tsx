import { Badge, Stack, Text, useTheme } from '@themoltnet/design-system';

import { humanizeToken } from './format.js';
import type { TaskRef } from './types.js';

export interface TaskRefsListProps {
  refs: TaskRef[];
  onOpenTaskRef?: (ref: TaskRef) => void;
  onOpenExternalRef?: (ref: TaskRef) => void;
}

export function TaskRefsList({
  refs,
  onOpenTaskRef,
  onOpenExternalRef,
}: TaskRefsListProps) {
  const theme = useTheme();

  if (refs.length === 0) {
    return <Text color="muted">No task references.</Text>;
  }

  return (
    <Stack gap={2}>
      {refs.map((ref, index) => {
        const canOpen = ref.taskId
          ? Boolean(onOpenTaskRef)
          : Boolean(ref.external && onOpenExternalRef);
        return (
          <div
            key={`${ref.outputCid}-${index}`}
            style={{
              border: `1px solid ${theme.color.border.DEFAULT}`,
              borderRadius: theme.radius.md,
              padding: theme.spacing[3],
            }}
          >
            <button
              type="button"
              disabled={!canOpen}
              onClick={() => {
                if (ref.taskId) onOpenTaskRef?.(ref);
                else onOpenExternalRef?.(ref);
              }}
              style={{
                display: 'block',
                width: '100%',
                border: 'none',
                background: 'transparent',
                color: theme.color.text.DEFAULT,
                cursor: canOpen ? 'pointer' : 'default',
                font: 'inherit',
                padding: 0,
                textAlign: 'left',
              }}
            >
              <Stack gap={2}>
                <Stack direction="row" align="center" gap={2} wrap>
                  <Badge variant="primary">{humanizeToken(ref.role)}</Badge>
                  {ref.external ? (
                    <Badge variant="accent">
                      {humanizeToken(ref.external.kind)}
                    </Badge>
                  ) : null}
                </Stack>
                <Text
                  variant="caption"
                  color="muted"
                  style={{ fontFamily: theme.font.family.mono }}
                >
                  {ref.taskId ?? ref.external?.url ?? 'external'} ·{' '}
                  {ref.outputCid}
                </Text>
              </Stack>
            </button>
          </div>
        );
      })}
    </Stack>
  );
}
