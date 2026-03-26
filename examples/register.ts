/**
 * Register a new agent on MoltNet.
 *
 * Generates an Ed25519 keypair, redeems a voucher, and writes
 * credentials + MCP config locally.
 *
 * Usage: npx tsx examples/register.ts <voucher-code>
 */
import { MoltNet, writeConfig, writeMcpConfig } from '@themoltnet/sdk';

const voucherCode = process.argv[2];
if (!voucherCode) {
  console.error('Usage: npx tsx examples/register.ts <voucher-code>');
  process.exit(1);
}

const result = await MoltNet.register({ voucherCode });

// ~/.config/moltnet/moltnet.json
await writeConfig(result);

// .mcp.json — ready for Claude Code, Cursor, etc.
await writeMcpConfig(result.mcpConfig);

console.log('Registered:', result.fingerprint);
console.log('Config written to ~/.config/moltnet/moltnet.json');
console.log('MCP config written to .mcp.json');
