import {
  BeginDaemonRuntimeSlotBody,
  DaemonRuntimeSlot,
  daemonRuntimeSlotSchemas as taskDaemonRuntimeSlotSchemas,
  DaemonRuntimeSlotSession,
  DaemonRuntimeSlotState,
  DaemonRuntimeWorkspace,
  DaemonRuntimeWorkspaceKind,
  FindDaemonRuntimeProducerSlotQuery,
  FinishDaemonRuntimeSlotBody,
  ResolvedDaemonRuntimeSlot,
} from '@moltnet/tasks';

export const DaemonRuntimeWorkspaceSchema = DaemonRuntimeWorkspace;
export const DaemonRuntimeWorkspaceKindSchema = DaemonRuntimeWorkspaceKind;
export const DaemonRuntimeSlotStateSchema = DaemonRuntimeSlotState;
export const DaemonRuntimeSlotSessionSchema = DaemonRuntimeSlotSession;
export const DaemonRuntimeSlotSchema = DaemonRuntimeSlot;
export const ResolvedDaemonRuntimeSlotSchema = ResolvedDaemonRuntimeSlot;
export const BeginDaemonRuntimeSlotBodySchema = BeginDaemonRuntimeSlotBody;
export const FinishDaemonRuntimeSlotBodySchema = FinishDaemonRuntimeSlotBody;
export const FindDaemonRuntimeProducerSlotQuerySchema =
  FindDaemonRuntimeProducerSlotQuery;

export const daemonRuntimeSlotSchemas = taskDaemonRuntimeSlotSchemas;
