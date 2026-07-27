import { randomBytes } from 'node:crypto';

import { SignerCeremonyService } from './ceremony-service.js';
import { createChallengeValidator } from './challenge-validator.js';
import { getSignerConfig } from './config.js';
import { createPreviewSignDevice } from './device.js';
import { createSignerLogger } from './logger.js';
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
  const logger = createSignerLogger(config.logFile);
  const service = new SignerCeremonyService({
    allowedOrigins: config.allowedOrigins,
    apiUrl: config.apiUrl,
    approvalBaseUrl: config.approvalBaseUrl,
    device: createPreviewSignDevice(undefined, {
      timeoutMs: config.deviceTimeoutMs,
    }),
    validateChallenge: createChallengeValidator(),
    randomToken: () => randomBytes(32).toString('base64url'),
    logger,
  });
  const server = createSignerServer(service);
  server.requestTimeout = 10_000;
  server.headersTimeout = 12_000;
  server.keepAliveTimeout = 5_000;
  server.listen(config.port, config.host, () => {
    logger.info('server.listening');
  });
  server.on('error', () => {
    logger.error('server.error');
  });

  const shutdown = () => {
    service.dispose();
    server.close((error) => {
      if (error) {
        logger.error('server.shutdown_failed');
        process.exitCode = 1;
      }
      logger.close();
    });
  };
  process.once('uncaughtException', (error) => {
    logger.error('process.uncaught_exception', { code: error.name });
    process.exitCode = 1;
    shutdown();
  });
  process.once('unhandledRejection', (reason) => {
    logger.error('process.unhandled_rejection', {
      code: reason instanceof Error ? reason.name : 'UnknownRejection',
    });
    process.exitCode = 1;
    shutdown();
  });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
