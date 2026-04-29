import { Badge, Stack, Text, useTheme } from '@themoltnet/design-system';

import {
  formatDateTime,
  getMessageText,
  humanizeToken,
  joinTextDeltas,
} from './format.js';
import { JsonViewer } from './json-viewer.js';
import type { TaskMessage } from './types.js';

export interface TaskMessagesTimelineProps {
  messages: TaskMessage[];
  joinText?: boolean;
}

export function TaskMessagesTimeline({
  messages,
  joinText = true,
}: TaskMessagesTimelineProps) {
  const theme = useTheme();
  const rendered = joinText ? joinTextDeltas(messages) : messages;

  if (rendered.length === 0) {
    return <Text color="muted">No attempt messages yet.</Text>;
  }

  return (
    <Stack gap={3}>
      {rendered.map((message) => {
        const isText = message.kind === 'text_delta';
        const isError = message.kind === 'error';
        const isTool =
          message.kind === 'tool_call_start' ||
          message.kind === 'tool_call_end';

        return (
          <div
            key={`${message.attemptN}-${message.seq}-${message.kind}`}
            style={{
              border: `1px solid ${
                isError ? theme.color.error.DEFAULT : theme.color.border.DEFAULT
              }`,
              borderRadius: theme.radius.md,
              padding: theme.spacing[3],
              borderColor: isError
                ? theme.color.error.DEFAULT
                : theme.color.border.DEFAULT,
            }}
          >
            <Stack gap={2}>
              <Stack
                direction="row"
                align="center"
                justify="space-between"
                gap={2}
                wrap
              >
                <Stack direction="row" align="center" gap={2} wrap>
                  <Badge
                    variant={isError ? 'error' : isTool ? 'accent' : 'default'}
                  >
                    {humanizeToken(message.kind)}
                  </Badge>
                  <Text
                    variant="caption"
                    color="muted"
                    style={{ fontFamily: theme.font.family.mono }}
                  >
                    #{message.seq}
                  </Text>
                </Stack>
                <Text variant="caption" color="muted">
                  {formatDateTime(message.timestamp)}
                </Text>
              </Stack>

              {isText || isError ? (
                <Text style={{ whiteSpace: 'pre-wrap' }}>
                  {getMessageText(message)}
                </Text>
              ) : (
                <JsonViewer value={message.payload} defaultExpanded={isTool} />
              )}
            </Stack>
          </div>
        );
      })}
    </Stack>
  );
}
