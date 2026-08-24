import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@moltnet/agent-config': resolve(
        import.meta.dirname,
        '../../libs/agent-config/src/index.ts',
      ),
      '@moltnet/crypto-service/content-cid': resolve(
        import.meta.dirname,
        '../../libs/crypto-service/src/content-cid.ts',
      ),
      '@moltnet/crypto-service/canonical-json': resolve(
        import.meta.dirname,
        '../../libs/crypto-service/src/canonical-json.ts',
      ),
      '@moltnet/crypto-service/json-cid': resolve(
        import.meta.dirname,
        '../../libs/crypto-service/src/json-cid.ts',
      ),
      '@moltnet/crypto-service/ssh': resolve(
        import.meta.dirname,
        '../../libs/crypto-service/src/ssh.ts',
      ),
      '@moltnet/crypto-service/sshsig': resolve(
        import.meta.dirname,
        '../../libs/crypto-service/src/sshsig.ts',
      ),
      '@moltnet/crypto-service/agent-signing': resolve(
        import.meta.dirname,
        '../../libs/crypto-service/src/agent-signing.ts',
      ),
      '@moltnet/crypto-service': resolve(
        import.meta.dirname,
        '../../libs/crypto-service/src/index.ts',
      ),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    root: resolve(import.meta.dirname),
    include: ['__tests__/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
