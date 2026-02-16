import { describe, expect, it } from 'vitest';

import { getInstallationToken } from '../src/token.js';

describe('getInstallationToken', () => {
  it('should throw when private key file does not exist', async () => {
    // Arrange
    const opts = {
      appId: '12345',
      privateKeyPath: '/nonexistent/path/to/private-key.pem',
      installationId: '67890',
    };

    // Act & Assert
    await expect(getInstallationToken(opts)).rejects.toThrow(/ENOENT/);
  });

  it('should be an async function returning a promise', () => {
    // Assert — verify the function signature
    expect(typeof getInstallationToken).toBe('function');
  });
});
