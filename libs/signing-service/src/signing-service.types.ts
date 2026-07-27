import type { PermissionChecker, RelationshipReader } from '@moltnet/auth';
import type {
  GroupRepository,
  SigningCredentialRepository,
  SigningRequestRepository,
  TransactionRunner,
} from '@moltnet/database';
import type { VerificationMethod } from '@moltnet/models';

export interface SigningServiceLogger {
  error(fields: Record<string, unknown>, message: string): void;
}

export interface SigningServiceDeps {
  signingCredentialRepository: SigningCredentialRepository;
  signingRequestRepository: SigningRequestRepository;
  transactionRunner: TransactionRunner;
  permissionChecker: PermissionChecker;
  relationshipReader: RelationshipReader;
  groupRepository: GroupRepository;
  signingTimeoutSeconds: number;
  maxPendingSigningRequests: number;
  logger?: SigningServiceLogger;
  startAgentSigningWorkflow?: (input: {
    id: string;
    agentId: string;
    message: string;
    nonce: string;
    verificationMethod: VerificationMethod;
  }) => Promise<{ workflowID: string }>;
  now?: () => Date;
  createId?: () => string;
}
