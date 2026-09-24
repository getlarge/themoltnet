import { useEffect, useRef, useState } from 'react';

import type { RunCenterActions } from './types.js';

export interface RunStopControl {
  pending: ReadonlySet<string>;
  errors: ReadonlySet<string>;
  stop: (runId: string) => void;
}

/** A successful stop request stays pending until status confirms the run left. */
export function useStopRun(
  actions: Pick<RunCenterActions, 'stopRun'>,
  activeRunIds: readonly string[],
): RunStopControl {
  const inFlight = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const active = new Set(activeRunIds);
    let changed = false;
    for (const runId of inFlight.current) {
      if (active.has(runId)) continue;
      inFlight.current.delete(runId);
      changed = true;
    }
    if (changed) setPending(new Set(inFlight.current));
    setErrors((previous) => {
      const next = new Set([...previous].filter((id) => active.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [activeRunIds]);

  const stop = (runId: string) => {
    if (inFlight.current.has(runId)) return;
    inFlight.current.add(runId);
    setPending(new Set(inFlight.current));
    setErrors((previous) => {
      const next = new Set(previous);
      next.delete(runId);
      return next;
    });
    void actions.stopRun(runId).catch(() => {
      inFlight.current.delete(runId);
      setPending(new Set(inFlight.current));
      setErrors((previous) => new Set(previous).add(runId));
    });
  };

  return { pending, errors, stop };
}
