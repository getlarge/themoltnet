import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

interface ToolExecutionEvent {
  toolCallId: string;
}

export interface SubmitCompletionCoordinator {
  extension: (pi: ExtensionAPI) => void;
  requestCompletion: () => void;
}

/**
 * Delay the post-submit session abort until every tool call in Pi's current
 * parallel batch has emitted `tool_execution_end`. A valid submit call can
 * finish before a sibling write or artifact upload; aborting immediately would
 * cancel that sibling after the runtime had already accepted the output.
 */
export function createSubmitCompletionCoordinator(options: {
  onDrained: () => void | Promise<void>;
  onError: (error: unknown) => void | Promise<void>;
}): SubmitCompletionCoordinator {
  const activeToolCalls = new Set<string>();
  let completionRequested = false;
  let completionStarted = false;

  const drain = (): void => {
    if (!completionRequested || completionStarted || activeToolCalls.size > 0) {
      return;
    }
    completionStarted = true;
    void Promise.resolve(options.onDrained()).catch(options.onError);
  };

  return {
    extension: (pi) => {
      pi.on('tool_execution_start', (event: ToolExecutionEvent) => {
        activeToolCalls.add(event.toolCallId);
      });
      pi.on('tool_execution_end', (event: ToolExecutionEvent) => {
        activeToolCalls.delete(event.toolCallId);
        drain();
      });
    },
    requestCompletion: () => {
      completionRequested = true;
      drain();
    },
  };
}
