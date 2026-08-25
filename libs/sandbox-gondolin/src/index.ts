export { abortableResource, delay, throwIfAborted } from './abort-utils.js';
export {
  execManagedCommand,
  type ManagedExecDiagnostic,
  type ManagedExecOptions,
  type ManagedExecResult,
  type ManagedExecTermination,
} from './managed-exec.js';
export { isResolvedPathInsideRoot } from './path-containment.js';
export {
  ensureSnapshot,
  type EnsureSnapshotOptions,
  GONDOLIN_BASE_EXECUTABLES,
  type ResumeCommand,
  type ResumeCommandWhen,
  type SandboxConfig,
  type SnapshotConfig,
} from './snapshot.js';
export * from './vm-manager.js';
