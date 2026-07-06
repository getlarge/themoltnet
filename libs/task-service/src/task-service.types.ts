import type { PermissionChecker, RelationshipWriter } from '@moltnet/auth';
import type { KetoNamespace } from '@moltnet/auth';
import type { ExecutorTrustLevel } from '@moltnet/crypto-service';
import type {
  AgentRepository,
  ContextPackRepository,
  CorrelationSealRepository,
  DiaryRepository,
  RenderedPackRepository,
  RuntimeProfileRepository,
  TaskRepository,
  TransactionRunner,
} from '@moltnet/database';
import type { TransactionalWorkflowEnqueue } from '@moltnet/task-workflows';
import type { ClaimCondition } from '@moltnet/tasks';

export interface Logger {
  info(obj: object, msg: string): void;
  debug(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface CreateTaskInput {
  taskType: string;
  title?: string;
  tags?: string[];
  teamId: string;
  diaryId?: string;
  inputPayload: Record<string, unknown>;
  references?: unknown[];
  correlationId?: string;
  claimCondition?: ClaimCondition;
  maxAttempts?: number;
  expiresInSec?: number;
  requiredExecutorTrustLevel?: ExecutorTrustLevel;
  allowedProfiles?: { profileId: string }[];
  dispatchTimeoutSec?: number;
  runningTimeoutSec?: number;
  callerId: string;
  callerNs: KetoNamespace;
  callerIsAgent: boolean;
  proposerId?: string;
}

export interface ExecutorAttestationInput {
  executorManifest?: Record<string, unknown>;
  executorFingerprint?: string;
  executorSignature?: string;
  profileId?: string;
}

export interface VerifiedExecutorAttestation {
  fingerprint: string;
  verification?: {
    trustLevel: 'agent_signed';
    evidence: Record<string, unknown>;
  };
}

export interface TaskServiceDeps {
  taskRepository: TaskRepository;
  diaryRepository: DiaryRepository;
  agentRepository: AgentRepository;
  runtimeProfileRepository: RuntimeProfileRepository;
  contextPackRepository: ContextPackRepository;
  renderedPackRepository: RenderedPackRepository;
  correlationSealRepository: CorrelationSealRepository;
  permissionChecker: PermissionChecker;
  relationshipWriter: RelationshipWriter;
  transactionRunner: TransactionRunner;
  enqueueWorkflowInCurrentTransaction: TransactionalWorkflowEnqueue;
  logger: Logger;
  taskLifetime?: {
    defaultExpiresInSec: number;
    maxExpiresInSec: number;
  };
}
