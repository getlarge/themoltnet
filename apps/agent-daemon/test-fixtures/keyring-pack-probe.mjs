import {
  createPiDaemonAdapter,
  defaultPiDaemonAdapter,
} from '@themoltnet/agent-daemon/pi';
import { OSKeyringSecretProvider } from '@themoltnet/sdk/node';

try {
  await new OSKeyringSecretProvider('unsupported').read('pack-probe');
  throw new Error('Expected unsupported-platform keyring read to fail');
} catch (error) {
  if (!String(error).includes('OS keyring is not supported')) {
    throw error;
  }
}

if (
  typeof createPiDaemonAdapter !== 'function' ||
  defaultPiDaemonAdapter.runtimeKind !== 'gondolin_pi'
)
  throw new Error('Pi adapter missing from packed daemon');
