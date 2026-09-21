import { CodeBlock, Stack, Text, useTheme } from '@themoltnet/design-system';
import { useState } from 'react';

import { compactIdentifier } from './task-output.js';

export interface JsonViewerProps {
  value: unknown;
  label?: string;
  cid?: string | null;
  /** Shorten the CID; the full value stays in the title. */
  compactCid?: boolean;
  defaultExpanded?: boolean;
}

export function JsonViewer({
  value,
  label,
  cid,
  compactCid = false,
  defaultExpanded = false,
}: JsonViewerProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(defaultExpanded);

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
            <Text
              variant="caption"
              color="muted"
              style={{
                fontFamily: theme.font.family.mono,
                minWidth: 0,
                overflowWrap: 'anywhere',
              }}
            >
              <span title={compactCid ? cid : undefined}>
                {compactCid ? compactIdentifier(cid) : cid}
              </span>
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
          {JSON.stringify(value, null, 2)}
        </CodeBlock>
      ) : null}
    </Stack>
  );
}
