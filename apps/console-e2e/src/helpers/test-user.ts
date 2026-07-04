import { randomBytes } from 'node:crypto';

export interface TestUser {
  email: string;
  username: string;
  password: string;
}

export interface CreateTestUserOptions {
  prefix?: string;
}

export function createTestUser({
  prefix = 'console-e2e',
}: CreateTestUserOptions = {}): TestUser {
  const nonce = randomBytes(4).toString('hex');
  const usernamePrefix = prefix.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  return {
    email: `${prefix}-${Date.now()}-${nonce}@example.com`,
    username: `${usernamePrefix}_${nonce}`,
    password: `ConsoleE2E!${nonce}abcd`,
  };
}
