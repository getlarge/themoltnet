export { writeMcpConfig } from './config.js';
export {
  /** @deprecated Use MoltNetConfig */
  type CredentialsFile,
  getConfigDir,
  getConfigPath,
  /** @deprecated Use getConfigPath */
  getCredentialsPath,
  type MoltNetConfig,
  readConfig,
  /** @deprecated Use readConfig */
  readCredentials,
  updateConfigSection,
  writeConfig,
  /** @deprecated Use writeConfig */
  writeCredentials,
} from './credentials.js';
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
export { sign } from './sign.js';
export { exportSSHKey } from './ssh.js';

import { info } from './info.js';
import { register } from './register.js';
import { sign } from './sign.js';

export const MoltNet = { register, info, sign } as const;
