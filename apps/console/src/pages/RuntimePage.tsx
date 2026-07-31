import { PageHeader, Stack } from '@themoltnet/design-system';
import type { ReactNode } from 'react';

import { useTeam } from '../team/useTeam.js';

export function RuntimePage({ children }: { children: ReactNode }) {
  const { selectedTeam } = useTeam();

  return (
    <Stack gap={6}>
      <PageHeader
        eyebrow="Agent Runtime"
        title="Runtime authority"
        description={`Manage profiles, tool policies, and agent keys${
          selectedTeam ? ` for ${selectedTeam.name}` : ''
        }.`}
      />
      {children}
    </Stack>
  );
}
