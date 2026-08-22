import {
  Badge,
  Button,
  Card,
  KeyFingerprint,
  Select,
  Text,
  useTheme,
} from '@themoltnet/design-system';

import { RoleBadge } from './RoleBadge.js';

export interface MemberTableEntry {
  subjectId: string;
  subjectType: 'agent' | 'human';
  role?: string;
  displayName: string;
  fingerprint?: string;
  email?: string;
}

interface MembersTableProps<T extends MemberTableEntry> {
  members: T[];
  roleOptions: (m: T) => readonly TeamRoleOption[];
  canRemove: (m: T) => boolean;
  updatingMemberId: string | null;
  onRoleChange: (m: T, role: string) => void;
  onRemove: (m: T) => void;
}

export interface TeamRoleOption {
  value: string;
  label: string;
}

export function editableTeamRoleOptions(
  member: Pick<MemberTableEntry, 'role' | 'subjectType'>,
): readonly TeamRoleOption[] {
  if (member.role === 'owner') return [];
  return member.subjectType === 'agent'
    ? [
        { value: 'member', label: 'Member' },
        { value: 'executor', label: 'Executor' },
        { value: 'manager', label: 'Manager' },
      ]
    : [
        { value: 'member', label: 'Member' },
        { value: 'manager', label: 'Manager' },
      ];
}

/**
 * Team members as a scannable table rather than a stack of cards: aligned
 * columns let an operator read identity, kind, and role down a single axis on a
 * permissions surface.
 */
export function MembersTable<T extends MemberTableEntry>({
  members,
  roleOptions,
  canRemove,
  updatingMemberId,
  onRoleChange,
  onRemove,
}: MembersTableProps<T>) {
  const theme = useTheme();
  const cellPad = `${theme.spacing[2]} ${theme.spacing[3]}`;
  const headStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: cellPad,
    borderBottom: `1px solid ${theme.color.border.DEFAULT}`,
    color: theme.color.text.secondary,
    fontWeight: theme.font.weight.medium,
    whiteSpace: 'nowrap',
  };

  return (
    <Card variant="outlined" padding="none">
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            // Stable min-width so dense columns overflow-scroll instead of
            // colliding on narrow viewports (design-system data-table rule 2).
            minWidth: '34rem',
            borderCollapse: 'collapse',
            fontSize: theme.font.size.sm,
          }}
        >
          <thead>
            <tr>
              <th scope="col" style={headStyle}>
                Member
              </th>
              <th scope="col" style={headStyle}>
                Type
              </th>
              <th scope="col" style={headStyle}>
                Role
              </th>
              <th scope="col" style={{ ...headStyle, textAlign: 'right' }}>
                <span
                  style={{
                    position: 'absolute',
                    width: 1,
                    height: 1,
                    overflow: 'hidden',
                    clip: 'rect(0 0 0 0)',
                  }}
                >
                  Actions
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <MemberTableRow
                key={m.subjectId}
                member={m}
                cellPad={cellPad}
                roleOptions={roleOptions(m)}
                roleActionPending={updatingMemberId === m.subjectId}
                canRemove={canRemove(m)}
                onRoleChange={(role) => onRoleChange(m, role)}
                onRemove={() => onRemove(m)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MemberTableRow({
  member,
  cellPad,
  roleOptions,
  roleActionPending,
  canRemove,
  onRoleChange,
  onRemove,
}: {
  member: MemberTableEntry;
  cellPad: string;
  roleOptions: readonly TeamRoleOption[];
  roleActionPending: boolean;
  canRemove: boolean;
  onRoleChange: (role: string) => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const rowBorder = `1px solid ${theme.color.border.DEFAULT}`;
  const td: React.CSSProperties = {
    padding: cellPad,
    borderBottom: rowBorder,
    verticalAlign: 'middle',
  };

  return (
    <tr>
      <td style={{ ...td, minWidth: 0 }}>
        {member.subjectType === 'agent' && member.fingerprint ? (
          <KeyFingerprint fingerprint={member.fingerprint} size="sm" copyable />
        ) : (
          <div style={{ minWidth: 0 }}>
            <Text variant="body">{member.displayName}</Text>
            {member.subjectType === 'human' && member.email && (
              <Text variant="caption" color="muted">
                {member.email}
              </Text>
            )}
          </div>
        )}
      </td>
      <td style={td}>
        <Badge variant="default">{member.subjectType}</Badge>
      </td>
      <td style={td}>
        {member.role && roleOptions.length > 0 ? (
          <Select
            aria-label={`Role for ${member.displayName}`}
            aria-busy={roleActionPending || undefined}
            size="sm"
            value={member.role}
            disabled={roleActionPending}
            onChange={(event) => onRoleChange(event.target.value)}
            style={{ minWidth: '8rem' }}
          >
            {roleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        ) : (
          member.role && <RoleBadge role={member.role} />
        )}
      </td>
      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
        {canRemove && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            style={{ marginLeft: theme.spacing[2] }}
          >
            Remove
          </Button>
        )}
      </td>
    </tr>
  );
}
