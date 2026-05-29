import { useTheme } from '@themoltnet/design-system';
import { useEffect, useRef } from 'react';

import {
  formatDateTime,
  getMessageText,
  humanizeToken,
  joinTextDeltas,
} from './format.js';
import type { TaskMessage } from './types.js';

type Theme = ReturnType<typeof useTheme>;

export interface TaskTurnStreamProps {
  messages: TaskMessage[];
  /** When true, auto-scroll to the latest line (live attempts). */
  live?: boolean;
  /**
   * Optional URL to documentation on running an agent daemon. When provided and
   * there are no turns yet, the waiting hint links here — the teachable moment
   * where a user wonders why a queued task isn't being executed.
   */
  learnMoreHref?: string;
}

function lineColor(theme: Theme, kind: TaskMessage['kind']): string {
  switch (kind) {
    case 'tool_call_start':
    case 'tool_call_end':
      return theme.color.accent.DEFAULT;
    case 'error':
      return theme.color.error.DEFAULT;
    case 'info':
      return theme.color.info.DEFAULT;
    default:
      return theme.color.text.DEFAULT;
  }
}

export function TaskTurnStream({
  messages,
  live,
  learnMoreHref,
}: TaskTurnStreamProps) {
  const theme = useTheme();
  const endRef = useRef<HTMLDivElement>(null);
  const rendered = joinTextDeltas(messages);

  useEffect(() => {
    if (live && typeof endRef.current?.scrollIntoView === 'function') {
      endRef.current.scrollIntoView({ block: 'end' });
    }
  }, [live, rendered.length]);

  if (rendered.length === 0) {
    return (
      <div
        style={{
          padding: theme.spacing[4],
          color: theme.color.text.muted,
          fontFamily: theme.font.family.mono,
          fontSize: theme.font.size.xs,
          lineHeight: theme.font.lineHeight.relaxed,
        }}
      >
        No turns yet — waiting for an agent to claim this task.
        {learnMoreHref ? (
          <>
            {' '}
            <a
              href={learnMoreHref}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: theme.color.primary.DEFAULT }}
            >
              Set up an agent daemon →
            </a>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div
      style={{
        fontFamily: theme.font.family.mono,
        fontSize: theme.font.size.xs,
        lineHeight: 1.7,
        padding: theme.spacing[3],
        overflow: 'auto',
      }}
    >
      {rendered.map((message) => (
        <div key={`${message.attemptN}-${message.seq}-${message.kind}`}>
          <span style={{ color: theme.color.text.muted }}>
            {formatDateTime(message.timestamp)}
          </span>{' '}
          <span style={{ color: lineColor(theme, message.kind) }}>
            {message.kind === 'text_delta'
              ? getMessageText(message)
              : `${humanizeToken(message.kind)}: ${getMessageText(message)}`}
          </span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
