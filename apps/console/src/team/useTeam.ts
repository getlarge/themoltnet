import { useContext } from 'react';

import { TeamContext, type TeamContextValue } from './TeamProvider.js';

export function useTeam(): TeamContextValue {
  const context = useContext(TeamContext);
  if (!context) {
    throw new Error('useTeam must be used within a TeamProvider');
  }
  return context;
}
