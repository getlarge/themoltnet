import type { PermissionChecker, RelationshipReader } from '@moltnet/auth';
import type {
  GroupRepository,
  SigningCredentialRepository,
  SigningRequestRepository,
  TransactionRunner,
} from '@moltnet/database';

export interface SigningServiceDeps {
  signingCredentialRepository: SigningCredentialRepository;
  signingRequestRepository: SigningRequestRepository;
  transactionRunner: TransactionRunner;
  permissionChecker: PermissionChecker;
  relationshipReader: RelationshipReader;
  groupRepository: GroupRepository;
  signingTimeoutSeconds: number;
  now?: () => Date;
  createId?: () => string;
}
