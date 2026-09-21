import { CodeBlock, Stack, Text, useTheme } from '@themoltnet/design-system';
import { useMemo, useState } from 'react';

import { Identifier } from './identifier.js';

export interface JsonViewerProps {
  value: unknown;
  label?: string;
  cid?: string | null;
  defaultExpanded?: boolean;
}

export function JsonViewer({
  value,
  label,
  cid,
  defaultExpanded = false,
}: JsonViewerProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(defaultExpanded);
  // Outputs can hold many 64 KiB artifact bodies; stringify only when shown.
  const pretty = useMemo(
    () => (expanded ? JSON.stringify(value, null, 2) : ''),
    [expanded, value],
  );

  return (
    <Stack gap={2}>
      {(label || cid) && (
        <Stack direction="row" justify="space-between" gap={3} wrap>
          {label ? (
            <Text variant="h4" style={{ margin: 0 }}>
              {label}
            </Text>
          ) : (
            <span />
          )}
          {cid ? (
            <Text variant="caption" color="muted" style={{ minWidth: 0 }}>
              <Identifier value={cid} />
            </Text>
          ) : null}
        </Stack>
      )}

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        style={{
          alignSelf: 'flex-start',
          border: `1px solid ${theme.color.border.DEFAULT}`,
          borderRadius: theme.radius.md,
          background: 'transparent',
          color: theme.color.text.secondary,
          cursor: 'pointer',
          font: 'inherit',
          fontSize: theme.font.size.sm,
          padding: `${theme.spacing[1]} ${theme.spacing[2]}`,
        }}
      >
        {expanded ? 'Collapse JSON' : 'Expand JSON'}
      </button>

      {expanded ? (
        <CodeBlock language="json" style={{ maxHeight: 420, overflow: 'auto' }}>
          {pretty}
        </CodeBlock>
      ) : null}
    </Stack>
  );
}
