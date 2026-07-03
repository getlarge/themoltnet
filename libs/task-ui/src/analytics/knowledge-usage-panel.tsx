import { Card, Stack, Text, useTheme } from '@themoltnet/design-system';

import { formatInteger, formatRatio } from './format.js';
import type { TaskActivityProductMetrics } from './types.js';

export interface KnowledgeUsagePanelProps {
  knowledge: TaskActivityProductMetrics['knowledge'];
}

/**
 * "Is it leveraging knowledge" — diary search/get and pack usage, plus the
 * headline leverage signal: knowledge tool calls per accepted task. Presented
 * so the reader can relate leverage to success at a glance.
 */
export function KnowledgeUsagePanel({ knowledge }: KnowledgeUsagePanelProps) {
  const theme = useTheme();

  const counters = [
    { label: 'Diary searches', value: knowledge.entrySearchCount },
    { label: 'Diary gets', value: knowledge.entryGetCount },
    { label: 'Pack renders', value: knowledge.packGetCount },
  ];

  return (
    <Card variant="outlined" padding="md">
      <Stack gap={3}>
        <Text variant="overline" style={{ color: theme.color.primary.DEFAULT }}>
          Knowledge leverage
        </Text>

        <Stack gap={1}>
          <Text variant="caption" color="muted">
            Knowledge calls per accepted task
          </Text>
          <span
            style={{
              fontSize: theme.font.size['2xl'],
              fontWeight: theme.font.weight.semibold,
              color: theme.color.text.DEFAULT,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatRatio(knowledge.knowledgeCallsPerAcceptedTask)}
          </span>
        </Stack>

        <Stack direction="row" gap={5} wrap>
          {counters.map((c) => (
            <Stack key={c.label} gap={1} style={{ minWidth: 0 }}>
              <Text variant="caption" color="muted">
                {c.label}
              </Text>
              <span
                style={{
                  fontSize: theme.font.size.lg,
                  fontWeight: theme.font.weight.medium,
                  color: theme.color.text.DEFAULT,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatInteger(c.value)}
              </span>
            </Stack>
          ))}
        </Stack>
      </Stack>
    </Card>
  );
}
