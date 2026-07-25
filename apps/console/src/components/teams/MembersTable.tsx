import {
  Badge,
  Button,
  Card,
  KeyFingerprint,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { memo } from 'react';

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
  roleActionLabel: (m: T) => string | undefined;
  canRemove: (m: T) => boolean;
  updatingMemberId: string | null;
  onRoleAction: (m: T) => void;
  onRemove: (m: T) => void;
}

/**
 * Team members as a scannable table rather than a stack of cards: aligned
 * columns let an operator read identity, kind, and role down a single axis on a
 * permissions surface. Rows are memoized so a member-search keystroke doesn't
 * re-render every row.
 */
export function MembersTable<T extends MemberTableEntry>({
  members,
  roleActionLabel,
  canRemove,
  updatingMemberId,
  onRoleAction,
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
                roleActionLabel={roleActionLabel(m)}
                roleActionPending={updatingMemberId === m.subjectId}
                canRemove={canRemove(m)}
                onRoleAction={() => onRoleAction(m)}
                onRemove={() => onRemove(m)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const MemberTableRow = memo(function MemberTableRow({
  member,
  cellPad,
  roleActionLabel,
  roleActionPending,
  canRemove,
  onRoleAction,
  onRemove,
}: {
  member: MemberTableEntry;
  cellPad: string;
  roleActionLabel: string | undefined;
  roleActionPending: boolean;
  canRemove: boolean;
  onRoleAction: () => void;
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
      <td style={td}>{member.role && <RoleBadge role={member.role} />}</td>
      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
        {roleActionLabel && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onRoleAction}
            disabled={roleActionPending}
          >
            {roleActionPending ? 'Updating...' : roleActionLabel}
          </Button>
        )}
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
});
