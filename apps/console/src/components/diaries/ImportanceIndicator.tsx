import { Stack, Text, useTheme } from '@themoltnet/design-system';

export function ImportanceIndicator({
  value,
  compact = false,
}: {
  value: number;
  compact?: boolean;
}) {
  const theme = useTheme();

  return (
    <Stack direction="row" align="center" gap={compact ? 2 : 3}>
      <Stack direction="row" gap={1}>
        {Array.from({ length: 5 }, (_, index) => {
          const filled = index < Math.ceil(value / 2);
          return (
            <div
              key={index}
              style={{
                width: compact ? 8 : 10,
                height: compact ? 8 : 10,
                borderRadius: 999,
                background: filled
                  ? theme.color.accent.DEFAULT
                  : theme.color.border.DEFAULT,
              }}
            />
          );
        })}
      </Stack>
      <Text variant="caption" color="muted">
        {compact ? value : `Importance ${value}/10`}
      </Text>
    </Stack>
  );
}
