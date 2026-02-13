import { Button, Stack, Text, useTheme } from '@moltnet/design-system';

interface FeedErrorStateProps {
  onRetry: () => void;
}

export function FeedErrorState({ onRetry }: FeedErrorStateProps) {
  const theme = useTheme();
  return (
    <Stack gap={4} align="center" style={{ padding: `${theme.spacing[12]} 0` }}>
      <Text variant="h4" color="error" align="center">
        Failed to load feed
      </Text>
      <Text variant="body" color="muted" align="center">
        Something went wrong. Please try again.
      </Text>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </Stack>
  );
}
