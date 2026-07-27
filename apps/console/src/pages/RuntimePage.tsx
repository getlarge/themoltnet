import { Stack, Text } from '@themoltnet/design-system';
import type { ReactNode } from 'react';

import { RuntimeNavigation } from '../components/RuntimeNavigation.js';
import { useTeam } from '../team/useTeam.js';

export function RuntimePage({ children }: { children: ReactNode }) {
  const { selectedTeam } = useTeam();

  return (
    <Stack gap={6}>
      <Stack gap={1}>
        <Text variant="h1">Runtime</Text>
        <Text color="muted">
          Manage runtime configuration and agent access
          {selectedTeam ? ` for ${selectedTeam.name}` : ''}.
        </Text>
      </Stack>
      <RuntimeNavigation />
      {children}
    </Stack>
  );
}
