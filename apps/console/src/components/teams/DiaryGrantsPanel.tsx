import {
  type ListDiaryGrantsResponses,
  revokeDiaryGrant,
} from '@moltnet/api-client';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  KeyFingerprint,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useState } from 'react';

import { getApiClient } from '../../api.js';

type Grant = ListDiaryGrantsResponses[200]['grants'][number];

export interface SubjectDisplay {
  id: string;
  type: 'Agent' | 'Human' | 'Group';
  label: string;
  fingerprint?: string;
}

interface DiaryGrantsPanelProps {
  diaryId: string;
  diaryName: string;
  grants: Grant[];
  resolveSubject: (
    subjectId: string,
    subjectNs: Grant['subjectNs'],
  ) => SubjectDisplay;
  canManage: boolean;
  onChange: () => void;
  onGrantClick: () => void;
}

export function DiaryGrantsPanel({
  diaryId,
  diaryName,
  grants,
  resolveSubject,
  canManage,
  onChange,
  onGrantClick,
}: DiaryGrantsPanelProps) {
  const theme = useTheme();
  const [confirmRevoke, setConfirmRevoke] = useState<Grant | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const writers = grants.filter((g) => g.role === 'writer');
  const managers = grants.filter((g) => g.role === 'manager');

  const handleRevoke = async (grant: Grant) => {
    setActionError(null);
    try {
      await revokeDiaryGrant({
        client: getApiClient(),
        path: { id: diaryId },
        body: {
          subjectId: grant.subjectId,
          subjectNs: grant.subjectNs,
          role: grant.role,
        },
      });
      onChange();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to revoke');
    }
    setConfirmRevoke(null);
  };

  return (
    <Stack
      gap={3}
      style={{
        borderTop: `1px dashed ${theme.color.border.DEFAULT}`,
        paddingTop: theme.spacing[3],
      }}
    >
      {actionError && (
        <Text variant="caption" style={{ color: theme.color.error.DEFAULT }}>
          {actionError}
        </Text>
      )}

      <GrantSection
        title="Managers"
        grants={managers}
        resolveSubject={resolveSubject}
        canRevoke={canManage}
        onRevoke={(g) => setConfirmRevoke(g)}
        emptyText="No explicit managers (owners get implicit manage)."
      />

      <GrantSection
        title="Writers"
        grants={writers}
        resolveSubject={resolveSubject}
        canRevoke={canManage}
        onRevoke={(g) => setConfirmRevoke(g)}
        emptyText="No explicit writers (managers get implicit write)."
      />

      {canManage && (
        <Stack direction="row" justify="flex-end">
          <Button variant="ghost" size="sm" onClick={onGrantClick}>
            Grant access...
          </Button>
        </Stack>
      )}

      <ConfirmDialog
        open={confirmRevoke !== null}
        title="Revoke grant"
        message={`Revoke access to "${diaryName}"? The subject will lose this access immediately. Implicit access (via team role or group) is not affected.`}
        confirmLabel="Revoke"
        destructive
        onConfirm={() => {
          if (confirmRevoke) void handleRevoke(confirmRevoke);
        }}
        onCancel={() => setConfirmRevoke(null)}
      />
    </Stack>
  );
}

function GrantSection({
  title,
  grants,
  resolveSubject,
  canRevoke,
  onRevoke,
  emptyText,
}: {
  title: string;
  grants: Grant[];
  resolveSubject: DiaryGrantsPanelProps['resolveSubject'];
  canRevoke: boolean;
  onRevoke: (g: Grant) => void;
  emptyText: string;
}) {
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
  const td: React.CSSProperties = {
    padding: cellPad,
    borderBottom: `1px solid ${theme.color.border.DEFAULT}`,
    verticalAlign: 'middle',
  };
  return (
    <Stack gap={2}>
      <Text variant="caption" color="muted">
        {title}
      </Text>
      {grants.length === 0 ? (
        <Text variant="caption" color="muted">
          {emptyText}
        </Text>
      ) : (
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
                    Subject
                  </th>
                  <th scope="col" style={headStyle}>
                    Type
                  </th>
                  {canRevoke && (
                    <th
                      scope="col"
                      style={{ ...headStyle, textAlign: 'right' }}
                    >
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
                  )}
                </tr>
              </thead>
              <tbody>
                {grants.map((g) => {
                  const subject = resolveSubject(g.subjectId, g.subjectNs);
                  return (
                    <tr key={`${g.subjectNs}:${g.subjectId}:${g.role}`}>
                      <td style={{ ...td, minWidth: 0 }}>
                        {subject.fingerprint ? (
                          <KeyFingerprint
                            fingerprint={subject.fingerprint}
                            size="sm"
                            copyable
                          />
                        ) : (
                          <Text
                            variant="body"
                            style={{ fontSize: theme.font.size.sm }}
                          >
                            {subject.label}
                          </Text>
                        )}
                      </td>
                      <td style={td}>
                        <Badge variant="default">{g.subjectNs}</Badge>
                      </td>
                      {canRevoke && (
                        <td
                          style={{
                            ...td,
                            textAlign: 'right',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onRevoke(g)}
                          >
                            Revoke
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </Stack>
  );
}
