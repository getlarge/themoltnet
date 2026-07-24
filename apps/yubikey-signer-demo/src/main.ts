import {
  createPreviewSignPrehash,
  CtapError,
  PreviewSignClient,
  PreviewSignError,
} from '@themoltnet/yubikey-preview-sign';
import { verifyP256PrehashedSignature } from '@themoltnet/yubikey-preview-sign/verify';

async function main(): Promise<void> {
  const client = new PreviewSignClient();
  const devices = await client.listDevices();
  const capableDevices = [];
  for (const candidate of devices) {
    const capabilities = await client.getCapabilities(candidate.id);
    if (capabilities.supportsPreviewSign) {
      capableDevices.push(candidate);
    }
  }

  const device = capableDevices[0];
  if (!device || capableDevices.length !== 1) {
    throw new Error(
      `Expected exactly one previewSign-capable FIDO HID device, found ${capableDevices.length} among ${devices.length} FIDO devices`,
    );
  }

  const enrollment = await client.enroll({
    deviceId: device.id,
    label: 'throwaway-phase-1-smoke',
  });
  const digest = createPreviewSignPrehash(
    new TextEncoder().encode(`MoltNet previewSign smoke ${Date.now()}`),
  );
  const first = await client.signDigest({
    enrollment,
    digest,
    deviceId: device.id,
    allowUnverifiedEnrollment: true,
  });
  const second = await client.signDigest({
    enrollment,
    digest,
    deviceId: device.id,
    allowUnverifiedEnrollment: true,
  });

  if (
    first.verificationKey.id === second.verificationKey.id ||
    (first.verificationKey.publicKey.x === second.verificationKey.publicKey.x &&
      first.verificationKey.publicKey.y === second.verificationKey.publicKey.y)
  ) {
    throw new Error('Fresh signing operations reused a derived child key');
  }
  for (const signed of [first, second]) {
    if (
      !verifyP256PrehashedSignature(
        digest,
        signed.signature,
        signed.verificationKey.publicKey,
      )
    ) {
      throw new Error('Offline verification failed');
    }
  }

  process.stdout.write(
    JSON.stringify(
      {
        deviceId: device.id,
        enrollmentId: enrollment.id,
        verificationKeyIds: [
          first.verificationKey.id,
          second.verificationKey.id,
        ],
        offlineVerified: true,
      },
      undefined,
      2,
    ) + '\n',
  );
}

function errorCause(error: Error): unknown {
  return error.cause instanceof Error
    ? { name: error.cause.name, message: error.cause.message }
    : error.cause;
}

main().catch((error: unknown) => {
  if (error instanceof CtapError || error instanceof PreviewSignError) {
    process.stderr.write(
      JSON.stringify(
        {
          name: error.name,
          code: error.code,
          message: error.message,
          details: error.details,
          cause: errorCause(error),
        },
        undefined,
        2,
      ) + '\n',
    );
  } else {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
  }
  process.exit(1);
});
