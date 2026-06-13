type ShutdownSignal = 'SIGINT' | 'SIGTERM';

type ShutdownSignalProcess = {
  exitCode?: string | number | null;
  stderr: { write(message: string): unknown };
  on(event: ShutdownSignal, listener: () => void): unknown;
  off(event: ShutdownSignal, listener: () => void): unknown;
};

export interface ShutdownSignalHandlers {
  dispose: () => void;
}

export interface InstallShutdownSignalHandlersOptions {
  logDrain: (signal: ShutdownSignal) => void;
  drain: (signal: ShutdownSignal) => void;
  proc?: ShutdownSignalProcess;
}

export function installShutdownSignalHandlers(
  opts: InstallShutdownSignalHandlersOptions,
): ShutdownSignalHandlers {
  const proc = opts.proc ?? process;
  let drainingSignal: ShutdownSignal | null = null;

  const onSignal = (signal: ShutdownSignal): void => {
    if (drainingSignal) {
      proc.stderr.write(
        `[agent-daemon] ${signal} received while already draining from ` +
          `${drainingSignal}; waiting for cleanup.\n`,
      );
      proc.exitCode = signalExitCode(signal);
      return;
    }

    drainingSignal = signal;
    proc.exitCode = signalExitCode(signal);
    try {
      opts.logDrain(signal);
    } catch (err) {
      proc.stderr.write(
        `[agent-daemon] failed to log ${signal}: ` +
          (err instanceof Error ? err.message : String(err)) +
          '\n',
      );
    }
    opts.drain(signal);
  };

  const handleSigint = () => onSignal('SIGINT');
  const handleSigterm = () => onSignal('SIGTERM');
  proc.on('SIGINT', handleSigint);
  proc.on('SIGTERM', handleSigterm);

  return {
    dispose: () => {
      proc.off('SIGINT', handleSigint);
      proc.off('SIGTERM', handleSigterm);
    },
  };
}

export function signalExitCode(signal: ShutdownSignal): number {
  return signal === 'SIGINT' ? 130 : 143;
}
