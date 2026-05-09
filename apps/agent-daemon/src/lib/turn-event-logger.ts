// Bridge `pi-extension` turn events to a pino logger. Suppresses
// `text_delta` (per-token chunks would flood the workflow log; the full
// stream still goes through the reporter to the API). Level mapping:
// error → warn, turn_end → info, everything else → debug.
import type { TurnEventHandler } from '@themoltnet/pi-extension';
import type { Logger } from 'pino';

export function makeTurnEventHandler(
  base: Logger,
  context: Record<string, unknown> = {},
): TurnEventHandler {
  const log = base.child({ name: 'agent-daemon.turn', ...context });
  return (event, summary) => {
    if (event === 'text_delta') return;
    const level =
      event === 'error' ? 'warn' : event === 'turn_end' ? 'info' : 'debug';
    log[level]({ event, ...summary }, `turn.${event}`);
  };
}
