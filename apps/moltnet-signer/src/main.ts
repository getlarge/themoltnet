import { randomBytes } from 'node:crypto';

import { SignerCeremonyService } from './ceremony-service.js';
import { createChallengeValidator } from './challenge-validator.js';
import { getSignerConfig } from './config.js';
import { createPreviewSignDevice } from './device.js';
import { createSignerServer } from './server.js';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(`MoltNet local previewSign companion

Usage:
  MOLTNET_SIGNER_PORT=<port> moltnet-signer

Configuration:
  MOLTNET_SIGNER_PORT             Required loopback port
  MOLTNET_API_URL                 Trusted MoltNet API origin
  MOLTNET_SIGNER_ALLOWED_ORIGINS  Comma-separated exact Console origins
`);
} else {
  startSigner();
}

function startSigner(): void {
  const config = getSignerConfig();
  const service = new SignerCeremonyService({
    allowedOrigins: config.allowedOrigins,
    apiUrl: config.apiUrl,
    approvalBaseUrl: config.approvalBaseUrl,
    device: createPreviewSignDevice(),
    validateChallenge: createChallengeValidator(),
    randomToken: () => randomBytes(32).toString('base64url'),
  });
  const server = createSignerServer(service);
  server.requestTimeout = 10_000;
  server.headersTimeout = 12_000;
  server.keepAliveTimeout = 5_000;
  server.listen(config.port, config.host, () => {
    process.stdout.write(
      `MoltNet signer listening on ${config.approvalBaseUrl}\n`,
    );
  });

  const shutdown = () => {
    server.close((error) => {
      if (error) {
        process.stderr.write('MoltNet signer could not shut down cleanly\n');
        process.exitCode = 1;
      }
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
