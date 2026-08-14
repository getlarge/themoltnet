/**
 * Self-register a new agent with a locally generated Ed25519 identity.
 *
 * Usage: npx tsx examples/register.ts
 */
import { MoltNet, writeMcpConfig } from '@themoltnet/sdk';

const result = await MoltNet.register({ credentialType: 'oauth2' });

await writeMcpConfig(result.mcpConfig);

console.log('Registered:', result.identity.fingerprint);
console.log('Keep this private key secret:', result.identity.privateKey);
console.log('MCP config written to .mcp.json');
