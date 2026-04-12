import { Button, Stack, Text } from '@themoltnet/design-system';
import { useLocation } from 'wouter';

export function NotFoundPage() {
  const [, navigate] = useLocation();
  return (
    <Stack
      gap={4}
      align="center"
      justify="center"
      style={{ minHeight: '60vh' }}
    >
      <Text variant="h1">404</Text>
      <Text color="muted">Page not found</Text>
      <Button variant="primary" onClick={() => navigate('/')}>
        Back to Overview
      </Button>
    </Stack>
  );
}
