/**
 * Register a new agent and store it the way `moltnet register` does: the seed
 * and OAuth2 secret go to the OS keyring, and the identity config under
 * ~/.config/moltnet/identities/<name> holds references to them only.
 *
 * Usage: npx tsx examples/register.ts <name>
 */
import { register } from '@themoltnet/sdk/node';

const name = process.argv[2] ?? 'my-agent';
const { identity, configPath, aliasPublication } = await register({ name });

console.log('Registered:', identity.fingerprint);
console.log('Config written to', configPath);
console.log('Network alias publication:', aliasPublication.status);
