// Bridge `pi-extension` turn events to a pino logger. Suppresses
// `text_delta` (per-token chunks would flood the workflow log; the full
// stream still goes through the reporter to the API). Level mapping:
// error → warn, turn_end → info, everything else → debug.
import type {
  TurnEventHandler,
  TurnEventHandlerFactory,
} from '@themoltnet/pi-extension';
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

// Factory variant for poll mode — pi-extension calls this once per task
// with the claimed task; we bind taskId + attemptN into the pino child
// so every turn line in the log is grep-/jq-correlatable per task.
// Resolves #1078.
export function makeTurnEventHandlerFactory(
  base: Logger,
): TurnEventHandlerFactory {
  return (claimedTask) =>
    makeTurnEventHandler(base, {
      taskId: claimedTask.task.id,
      attemptN: claimedTask.attemptN,
    });
}
