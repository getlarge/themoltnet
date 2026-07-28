import type { CredentialAuthorizationError } from './contracts.js';

export type CredentialErrorCode = CredentialAuthorizationError['code'];

export class CredentialError extends Error {
  readonly code: CredentialErrorCode;

  constructor(code: CredentialErrorCode, message: string) {
    super(message);
    this.name = 'CredentialError';
    this.code = code;
  }

  toJSON(): CredentialAuthorizationError {
    return { version: 1, code: this.code, message: this.message };
  }
}
