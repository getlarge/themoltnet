import { afterEach, describe, expect, it, vi } from 'vitest';

import { runAgentDaemonCli } from './cli.js';
import { runOnce } from './cli/once.js';
import { processEnvSnapshot } from './config.js';
import type { DaemonRuntimeAdapter } from './runtime.js';

vi.mock('./cli/once.js', () => ({ runOnce: vi.fn().mockResolvedValue(0) }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe('legacy store notice at CLI dispatch', () => {
  it.each([
    { argv: ['--help'], notice: false },
    { argv: ['once', '--help'], notice: false },
    { argv: ['once', '--', '-h'], notice: true },
    { argv: ['update', '-h'], notice: true },
  ])(
    'handles $argv according to command help semantics',
    async ({ argv, notice }) => {
      vi.stubEnv('MOLTNET_AGENT_SERVER_ROOT', '/tmp/legacy-store');
      vi.stubEnv('MOLTNET_LEGACY_STORE_NOTICE_SHOWN', '');
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});
      await runAgentDaemonCli({ argv, runtime: {} as DaemonRuntimeAdapter });
      expect(
        errors.mock.calls.some(([message]) =>
          String(message).includes('is deprecated'),
        ),
      ).toBe(notice);
      expect(
        processEnvSnapshot().MOLTNET_LEGACY_STORE_NOTICE_SHOWN === '1',
      ).toBe(notice);
      if (argv[0] === 'once')
        expect(runOnce).toHaveBeenCalledWith(argv.slice(1), {});
    },
  );
});
