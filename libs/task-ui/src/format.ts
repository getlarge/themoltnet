import type { TaskAttemptStatus, TaskMessage, TaskStatus } from './types.js';

export function humanizeToken(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function formatRelativeAge(
  value: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const diffMs = now.getTime() - date.getTime();
  const absMs = Math.abs(diffMs);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (absMs >= size) {
      return rtf.format(Math.round(-diffMs / size), unit);
    }
  }
  return rtf.format(Math.round(-diffMs / 1000), 'second');
}

export function taskStatusTone(
  status: TaskStatus | TaskAttemptStatus,
): 'default' | 'info' | 'success' | 'warning' | 'error' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
    case 'timed_out':
    case 'expired':
      return 'error';
    case 'cancelled':
      return 'warning';
    case 'running':
    case 'claimed':
    case 'dispatched':
      return 'info';
    case 'queued':
    default:
      return 'default';
  }
}

export function getMessageText(message: TaskMessage): string {
  const text = message.payload.text;
  if (typeof text === 'string') return text;

  const messageValue = message.payload.message;
  if (typeof messageValue === 'string') return messageValue;

  const errorValue = message.payload.error;
  if (typeof errorValue === 'string') return errorValue;

  return JSON.stringify(message.payload);
}

export function joinTextDeltas(messages: TaskMessage[]): TaskMessage[] {
  const result: TaskMessage[] = [];
  let current: TaskMessage | null = null;

  for (const message of messages) {
    if (message.kind !== 'text_delta') {
      if (current) {
        result.push(current);
        current = null;
      }
      result.push(message);
      continue;
    }

    if (!current) {
      current = {
        ...message,
        payload: { text: getMessageText(message) },
      };
      continue;
    }

    current = {
      ...current,
      payload: {
        text: `${getMessageText(current)}${getMessageText(message)}`,
      },
    };
  }

  if (current) result.push(current);
  return result;
}
