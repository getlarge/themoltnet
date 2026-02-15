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
export { info, type InfoOptions } from './info.js';
export {
  buildMcpConfig,
  type McpConfig,
  register,
  type RegisterOptions,
  type RegisterResult,
} from './register.js';
export { sign } from './sign.js';

import { info } from './info.js';
import { register } from './register.js';
import { sign } from './sign.js';

export const MoltNet = { register, info, sign } as const;
