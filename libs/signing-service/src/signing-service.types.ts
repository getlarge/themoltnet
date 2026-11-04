import type { PermissionChecker, RelationshipReader } from '@moltnet/auth';
import type {
  GroupRepository,
  HumanRepository,
  SigningCredentialRepository,
  SigningRequester,
  SigningRequestRepository,
  TransactionRunner,
} from '@moltnet/database';
import type { VerificationMethod } from '@moltnet/models';

interface SigningServiceLogger {
  error(fields: Record<string, unknown>, message: string): void;
}

export interface SigningServiceDeps {
  signingCredentialRepository: SigningCredentialRepository;
  signingRequestRepository: SigningRequestRepository;
  transactionRunner: TransactionRunner;
  permissionChecker: PermissionChecker;
  relationshipReader: RelationshipReader;
  groupRepository: GroupRepository;
  humanRepository: Pick<HumanRepository, 'findById'>;
  signingTimeoutSeconds: number;
  maxPendingSigningRequests: number;
  logger?: SigningServiceLogger;
  startAgentSigningWorkflow?: (input: {
    id: string;
    requester: SigningRequester;
    message: string;
    nonce: string;
    verificationMethod: VerificationMethod;
  }) => Promise<{ workflowID: string }>;
  now?: () => Date;
  createId?: () => string;
}
