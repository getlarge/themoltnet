import { Text, useTheme } from '@themoltnet/design-system';

import { useTeam } from '../team/useTeam.js';

export function TeamSelector() {
  const theme = useTheme();
  const { teams, selectedTeam, selectTeam, isLoading, error } = useTeam();

  if (isLoading) {
    return (
      <Text variant="caption" color="muted">
        Loading teams...
      </Text>
    );
  }

  if (error) {
    return (
      <div
        title={error.message}
        style={{
          padding: `${theme.spacing[2]} ${theme.spacing[3]}`,
          color: theme.color.error.DEFAULT,
        }}
      >
        <Text variant="caption" color="muted">
          Failed to load teams
        </Text>
      </div>
    );
  }

  if (teams.length <= 1) {
    return (
      <Text
        variant="body"
        style={{ padding: `${theme.spacing[2]} ${theme.spacing[3]}` }}
      >
        {selectedTeam?.name ?? 'No team'}
      </Text>
    );
  }

  return (
    <select
      aria-label="Select team"
      value={selectedTeam?.id ?? ''}
      onChange={(e) => selectTeam(e.target.value)}
      style={{
        width: '100%',
        padding: `${theme.spacing[2]} ${theme.spacing[3]}`,
        background: theme.color.bg.surface,
        color: theme.color.text.DEFAULT,
        border: `1px solid ${theme.color.border.DEFAULT}`,
        borderRadius: theme.radius.sm,
        fontFamily: theme.font.family.sans,
        fontSize: theme.font.size.sm,
        cursor: 'pointer',
        outline: 'none',
      }}
    >
      {teams.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}
