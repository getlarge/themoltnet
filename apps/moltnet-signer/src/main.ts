import { randomBytes } from 'node:crypto';

import pino from 'pino';

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
  void startSigner().catch((error: unknown) => {
    const logger = pino(
      { name: 'moltnet-signer' },
      pino.destination({ dest: 2, sync: false }),
    );
    logger.fatal(
      { code: error instanceof Error ? error.name : 'UnknownError' },
      'server.start_failed',
    );
    process.exitCode = 1;
  });
}

async function startSigner(): Promise<void> {
  const config = getSignerConfig();
  const destinations = [
    pino.destination({ dest: 2, sync: false }),
    ...(config.logFile
      ? [
          pino.destination({
            append: true,
            dest: config.logFile,
            mkdir: true,
            mode: 0o600,
            sync: false,
          }),
        ]
      : []),
  ];
  const logger = pino(
    {
      name: 'moltnet-signer',
      redact: {
        paths: [
          'req.headers.x-moltnet-signer-session',
          'request.headers.x-moltnet-signer-session',
          '*.additionalArguments',
          '*.challenge',
          '*.digest',
          '*.envelope',
          '*.receipt',
          '*.signature',
          '*.token',
        ],
        remove: true,
      },
    },
    pino.multistream(destinations.map((stream) => ({ stream }))),
  );
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
  const server = createSignerServer(service, { logger });
  const address = await server.listen({
    port: config.port,
    host: config.host,
  });
  logger.info(
    {
      address,
      allowedOriginCount: config.allowedOrigins.length,
    },
    'server.listening',
  );

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    service.dispose();
    shutdownPromise = server
      .close()
      .catch((error: unknown) => {
        logger.error(
          { code: error instanceof Error ? error.name : 'UnknownError' },
          'server.shutdown_failed',
        );
        process.exitCode = 1;
      })
      .finally(() => {
        for (const destination of destinations) destination.end();
      });
    return shutdownPromise;
  };
  process.once('uncaughtException', (error) => {
    logger.fatal({ code: error.name }, 'process.uncaught_exception');
    process.exitCode = 1;
    void shutdown();
  });
  process.once('unhandledRejection', (reason) => {
    logger.fatal(
      {
        code: reason instanceof Error ? reason.name : 'UnknownRejection',
      },
      'process.unhandled_rejection',
    );
    process.exitCode = 1;
    void shutdown();
  });
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}
