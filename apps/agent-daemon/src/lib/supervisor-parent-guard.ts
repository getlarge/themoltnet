interface SupervisedProcess {
  connected?: boolean;
  env: NodeJS.ProcessEnv;
  pid: number;
  disconnect?: () => void;
  once(event: 'disconnect', listener: () => void): unknown;
  kill(pid: number, signal: NodeJS.Signals): boolean;
}

/** Exit a supervised run when its serve parent's IPC channel disappears. */
export function installSupervisorParentGuard(
  proc: SupervisedProcess = process,
): boolean {
  if (
    proc.env['MOLTNET_SUPERVISED_RUN'] !== '1' ||
    typeof proc.disconnect !== 'function'
  ) {
    return false;
  }
  if (proc.connected === false) {
    proc.kill(proc.pid, 'SIGTERM');
    return true;
  }
  proc.once('disconnect', () => proc.kill(proc.pid, 'SIGTERM'));
  return true;
}
