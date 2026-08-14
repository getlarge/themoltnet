import { OSKeyringSecretProvider } from '@themoltnet/sdk/node';

try {
  await new OSKeyringSecretProvider('unsupported').read('pack-probe');
  throw new Error('Expected unsupported-platform keyring read to fail');
} catch (error) {
  if (!String(error).includes('OS keyring is not supported')) {
    throw error;
  }
}
