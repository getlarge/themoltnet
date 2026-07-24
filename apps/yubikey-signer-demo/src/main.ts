import {
  createPreviewSignDigestV1,
  PreviewSignClient,
} from '@themoltnet/yubikey-preview-sign';
import { verifyP256PrehashedSignature } from '@themoltnet/yubikey-preview-sign/verify';

const client = new PreviewSignClient();
const devices = await client.listDevices();
const device = devices[0];
if (!device || devices.length !== 1) {
  throw new Error(
    `Expected exactly one FIDO HID device, found ${devices.length}`,
  );
}

const enrollment = await client.enroll({
  deviceId: device.id,
  label: 'throwaway-phase-1-smoke',
});
const digest = createPreviewSignDigestV1(
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
      verificationKeyIds: [first.verificationKey.id, second.verificationKey.id],
      offlineVerified: true,
    },
    undefined,
    2,
  ) + '\n',
);
