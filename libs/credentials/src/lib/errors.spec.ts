import { CredentialError } from '../index.js';

describe('CredentialError', () => {
  it('serializes only the versioned public error contract', () => {
    const error = new CredentialError(
      'credential_signature_invalid',
      'Credential signature is invalid',
    );
    Object.assign(error, {
      internalDiagnostic: 'parent-secret',
    });

    expect(error.toJSON()).toEqual({
      version: 1,
      code: 'credential_signature_invalid',
      message: 'Credential signature is invalid',
    });
    expect(JSON.stringify(error.toJSON())).not.toContain('parent-secret');
  });
});
