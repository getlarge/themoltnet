import { Button, Card, Stack, Text } from '@themoltnet/design-system';
import { useId, useState } from 'react';

import { TaskGrantsPanel } from './TaskGrantsPanel.js';

export function ManageTaskGrants({
  taskId,
  teamId,
  canManage,
}: {
  taskId: string;
  teamId: string;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <Card variant="surface" padding="md">
      <Stack gap={open ? 4 : 2}>
        <Stack
          direction="row"
          gap={3}
          align="center"
          justify="space-between"
          style={{ flexWrap: 'wrap' }}
        >
          <Stack gap={1}>
            <Text variant="h3" style={{ margin: 0 }}>
              Task authority
            </Text>
            <Text color="muted">
              Inspect explicit writers and managers only when you need them.
            </Text>
          </Stack>
          <Button
            variant="secondary"
            size="sm"
            aria-controls={panelId}
            aria-expanded={open}
            onClick={() => setOpen((visible) => !visible)}
          >
            {open ? 'Hide grants' : canManage ? 'Manage grants' : 'View grants'}
          </Button>
        </Stack>

        {open ? (
          <div id={panelId}>
            <TaskGrantsPanel
              taskId={taskId}
              teamId={teamId}
              canManage={canManage}
            />
          </div>
        ) : null}
      </Stack>
    </Card>
  );
}
