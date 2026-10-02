import { OSKeyringSecretProvider } from '@themoltnet/sdk/node';

try {
  await new OSKeyringSecretProvider('unsupported').read('pack-probe');
  throw new Error('Expected unsupported-platform keyring read to fail');
} catch (error) {
  if (!String(error).includes('OS keyring is not supported')) {
    throw error;
  }
}

const { createClassificationDaemonAdapter } =
  await import('@themoltnet/agent-daemon/classification');
const { createDurableDaemonAdapter } =
  await import('@themoltnet/agent-daemon/durable');
if (
  typeof createClassificationDaemonAdapter !== 'function' ||
  typeof createDurableDaemonAdapter !== 'function'
)
  throw new Error('Runtime adapters missing from packed daemon');
