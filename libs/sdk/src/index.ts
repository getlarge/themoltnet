export type {
  Agent,
  AgentsNamespace,
  AuthNamespace,
  CryptoNamespace,
  DiariesNamespace,
  DiaryGrantsNamespace,
  EntriesNamespace,
  LegreffierNamespace,
  PacksNamespace,
  ProblemsNamespace,
  PublicNamespace,
  RecoveryNamespace,
  SigningRequestsNamespace,
  TeamsNamespace,
  VouchNamespace,
} from './agent.js';
export { createAgent } from './agent.js';
export { writeMcpConfig } from './config.js';
export { connect, type ConnectOptions } from './connect.js';
export {
  deriveMcpUrl,
  getConfigDir,
  getConfigPath,
  type MoltNetConfig,
  readConfig,
  updateConfigSection,
  writeConfig,
} from './credentials.js';
export {
  decryptFromAgent,
  decryptWithCredentials,
  deriveEncryptionKeys,
  encryptForAgent,
  type SealedEnvelope,
} from './encrypt.js';
export {
  AuthenticationError,
  MoltNetError,
  NetworkError,
  problemToError,
  RegistrationError,
} from './errors.js';
export { info, type InfoOptions } from './info.js';
export {
  buildMcpConfig,
  type McpConfig,
  register,
  type RegisterOptions,
  type RegisterResult,
} from './register.js';
export { type ConfigIssue, repairConfig, type RepairResult } from './repair.js';
export { type RetryOptions } from './retry.js';
export { sign, signBytes } from './sign.js';
export { exportSSHKey } from './ssh.js';
export { TokenManager, type TokenManagerOptions } from './token.js';
export {
  computeCanonicalHash,
  computeContentCid,
} from '@moltnet/crypto-service';

import { connect } from './connect.js';
import { info } from './info.js';
import { register } from './register.js';
import { sign } from './sign.js';

export const MoltNet = { register, info, sign, connect } as const;
