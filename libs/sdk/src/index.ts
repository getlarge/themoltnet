export { writeMcpConfig } from './config.js';
export {
  type CredentialsFile,
  getConfigDir,
  getCredentialsPath,
  readCredentials,
  writeCredentials,
} from './credentials.js';
export {
  MoltNetError,
  NetworkError,
  problemToError,
  RegistrationError,
} from './errors.js';
export {
  buildMcpConfig,
  type McpConfig,
  register,
  type RegisterOptions,
  type RegisterResult,
} from './register.js';

import { register } from './register.js';

export const MoltNet = { register } as const;
