import {
  PreviewSignClient,
  PreviewSignPresence,
} from '@themoltnet/yubikey-preview-sign';

import { SignerCeremonyError, type SignerDevice } from './ceremony-service.js';

export function createPreviewSignDevice(
  client = new PreviewSignClient(),
  options: { timeoutMs?: number } = {},
): SignerDevice {
  const timeoutMs = options.timeoutMs ?? 75_000;
  return {
    async enroll(label) {
      const enrollment = await withDeviceDeadline(timeoutMs, async () => {
        const deviceId = await selectDevice(client);
        return client.enroll({
          deviceId,
          label,
          presence: PreviewSignPresence.RequireUserPresence,
        });
      });
      const { encoded: _encoded, ...seedPublicKey } = enrollment.seedPublicKey;
      if (
        enrollment.outerPublicKey.algorithm !== -7 ||
        seedPublicKey.blindingKey.algorithm !== -7 ||
        seedPublicKey.kemKey.algorithm !== -25
      ) {
        throw new Error('Security key returned unsupported public material');
      }
      return {
        version: 1,
        outerCredentialId: enrollment.outerCredentialId,
        outerPublicKey: {
          ...enrollment.outerPublicKey,
          algorithm: -7,
        },
        previewKeyHandle: enrollment.previewKeyHandle,
        seedPublicKey: {
          ...seedPublicKey,
          blindingKey: {
            ...seedPublicKey.blindingKey,
            algorithm: -7,
          },
          kemKey: {
            ...seedPublicKey.kemKey,
            algorithm: -25,
          },
        },
      };
    },
    async signPreparedDigest(input) {
      return withDeviceDeadline(timeoutMs, async () => {
        const deviceId = await selectDevice(client);
        return client.signPreparedDigest({
          ...input,
          deviceId,
          presence: PreviewSignPresence.RequireUserPresence,
        });
      });
    },
  };
}

async function withDeviceDeadline<T>(
  timeoutMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new SignerCeremonyError(
                'device_timeout',
                'Security key operation timed out; reconnect the key and retry',
              ),
            ),
          timeoutMs,
        );
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function selectDevice(client: PreviewSignClient): Promise<string> {
  const devices = await client.listDevices();
  const capable: string[] = [];
  for (const device of devices) {
    const capabilities = await client.getCapabilities(device.id);
    if (capabilities.supportsPreviewSign && capabilities.supportsCtap23) {
      capable.push(device.id);
    }
  }
  if (capable.length !== 1) {
    throw new Error(
      capable.length === 0
        ? 'Connect one previewSign-capable security key'
        : 'Connect only one previewSign-capable security key',
    );
  }
  const selected = capable[0];
  if (selected === undefined) {
    throw new Error('Connect one previewSign-capable security key');
  }
  return selected;
}
