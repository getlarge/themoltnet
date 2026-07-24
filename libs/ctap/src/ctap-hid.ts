import { randomBytes } from 'node:crypto';

import {
  bytesEqual,
  concatBytes,
  readU16be,
  readU32be,
  sha256,
  toBase64Url,
  u16be,
  u32be,
} from './bytes.js';
import { CtapError, invariant } from './errors.js';
import type { CtapConnection, DeviceDescriptor } from './types.js';

const FIDO_USAGE_PAGE = 0xf1d0;
const FIDO_USAGE = 0x01;
const BROADCAST_CHANNEL = 0xffffffff;
const CTAPHID_INIT = 0x86;
const CTAPHID_CBOR = 0x90;
const CTAPHID_CANCEL = 0x91;
const CTAPHID_KEEPALIVE = 0xbb;
const CTAPHID_ERROR = 0xbf;
const PACKET_SIZE = 64;
const INITIAL_DATA_SIZE = 57;
const CONTINUATION_DATA_SIZE = 59;
const MAX_PAYLOAD_SIZE = 7609;
const KEEPALIVE_STATUS_PROCESSING = 0x01;
const KEEPALIVE_STATUS_UP_NEEDED = 0x02;

const CTAP_STATUS_NAMES: Readonly<Record<number, string>> = {
  0x01: 'INVALID_COMMAND',
  0x02: 'INVALID_PARAMETER',
  0x03: 'INVALID_LENGTH',
  0x04: 'INVALID_SEQUENCE',
  0x05: 'TIMEOUT',
  0x06: 'CHANNEL_BUSY',
  0x0b: 'INVALID_CBOR',
  0x12: 'MISSING_PARAMETER',
  0x19: 'CREDENTIAL_EXCLUDED',
  0x21: 'PROCESSING',
  0x22: 'INVALID_CREDENTIAL',
  0x23: 'USER_ACTION_PENDING',
  0x24: 'OPERATION_PENDING',
  0x25: 'NO_OPERATIONS',
  0x26: 'UNSUPPORTED_ALGORITHM',
  0x27: 'OPERATION_DENIED',
  0x28: 'KEY_STORE_FULL',
  0x2b: 'UNSUPPORTED_OPTION',
  0x2c: 'INVALID_OPTION',
  0x2d: 'KEEPALIVE_CANCEL',
  0x2e: 'NO_CREDENTIALS',
  0x2f: 'USER_ACTION_TIMEOUT',
  0x30: 'NOT_ALLOWED',
  0x31: 'PIN_INVALID',
  0x32: 'PIN_BLOCKED',
  0x33: 'PIN_AUTH_INVALID',
  0x34: 'PIN_AUTH_BLOCKED',
  0x35: 'PIN_NOT_SET',
  0x36: 'PIN_REQUIRED',
  0x37: 'PIN_POLICY_VIOLATION',
  0x38: 'PIN_TOKEN_EXPIRED',
  0x39: 'REQUEST_TOO_LARGE',
  0x3a: 'ACTION_TIMEOUT',
  0x3b: 'USER_PRESENCE_REQUIRED',
  0x3c: 'USER_VERIFICATION_BLOCKED',
  0x3d: 'INTEGRITY_FAILURE',
  0x3e: 'INVALID_SUBCOMMAND',
  0x3f: 'USER_VERIFICATION_INVALID',
  0x40: 'UNAUTHORIZED_PERMISSION',
  0x7f: 'OTHER',
};

const CTAPHID_ERROR_NAMES: Readonly<Record<number, string>> = {
  0x01: 'INVALID_COMMAND',
  0x02: 'INVALID_PARAMETER',
  0x03: 'INVALID_LENGTH',
  0x04: 'INVALID_SEQUENCE',
  0x05: 'MESSAGE_TIMEOUT',
  0x06: 'CHANNEL_BUSY',
  0x0a: 'LOCK_REQUIRED',
  0x0b: 'INVALID_CHANNEL',
  0x7f: 'OTHER',
};

function ctapStatusName(status: number): string {
  return CTAP_STATUS_NAMES[status] ?? 'UNKNOWN';
}

function ctapHidErrorName(status: number): string {
  return CTAPHID_ERROR_NAMES[status] ?? 'UNKNOWN';
}

export interface HidDeviceInfo {
  path?: string;
  vendorId: number;
  productId: number;
  serialNumber?: string;
  manufacturer?: string;
  product?: string;
  usagePage?: number;
  usage?: number;
}

export interface HidConnection {
  write(data: Uint8Array): Promise<number>;
  read(timeoutMs?: number): Promise<Uint8Array | undefined>;
  close(): Promise<void>;
}

export interface HidProvider {
  devices(): Promise<HidDeviceInfo[]>;
  open(path: string): Promise<HidConnection>;
}

export class NodeHidProvider implements HidProvider {
  async devices(): Promise<HidDeviceInfo[]> {
    const { devicesAsync } = await import('node-hid');
    return devicesAsync();
  }

  async open(path: string): Promise<HidConnection> {
    const { HIDAsync } = await import('node-hid');
    const device = await HIDAsync.open(path);
    return {
      async write(data) {
        return device.write(Buffer.from(data));
      },
      async read(timeoutMs) {
        const value = await device.read(timeoutMs);
        return value ? new Uint8Array(value) : undefined;
      },
      async close() {
        await device.close();
      },
    };
  }
}

export function describeDevice(device: HidDeviceInfo): DeviceDescriptor {
  invariant(
    device.path,
    'TRANSPORT_ERROR',
    'HID device does not expose a path',
  );
  return {
    id: toBase64Url(sha256(new TextEncoder().encode(device.path))).slice(0, 22),
    path: device.path,
    product: device.product,
    manufacturer: device.manufacturer,
    serialNumber: device.serialNumber,
    vendorId: device.vendorId,
    productId: device.productId,
  };
}

export async function listFidoDevices(
  provider: HidProvider = new NodeHidProvider(),
): Promise<DeviceDescriptor[]> {
  return (await provider.devices())
    .filter(
      (device) =>
        device.path &&
        device.usagePage === FIDO_USAGE_PAGE &&
        (device.usage === undefined || device.usage === FIDO_USAGE),
    )
    .map(describeDevice);
}

export interface HidMessage {
  channel: number;
  command: number;
  payload: Uint8Array;
}

export function encodeHidMessage(message: HidMessage): Uint8Array[] {
  invariant(
    message.payload.length <= MAX_PAYLOAD_SIZE,
    'TRANSPORT_ERROR',
    'CTAPHID payload is too large',
  );
  const packets: Uint8Array[] = [];
  const initial = new Uint8Array(PACKET_SIZE);
  initial.set(u32be(message.channel), 0);
  initial[4] = message.command | 0x80;
  initial.set(u16be(message.payload.length), 5);
  initial.set(message.payload.slice(0, INITIAL_DATA_SIZE), 7);
  packets.push(initial);
  let offset = INITIAL_DATA_SIZE;
  let sequence = 0;
  while (offset < message.payload.length) {
    const packet = new Uint8Array(PACKET_SIZE);
    packet.set(u32be(message.channel), 0);
    packet[4] = sequence;
    packet.set(
      message.payload.slice(offset, offset + CONTINUATION_DATA_SIZE),
      5,
    );
    packets.push(packet);
    offset += CONTINUATION_DATA_SIZE;
    sequence += 1;
  }
  return packets;
}

function normalizePacket(packet: Uint8Array): Uint8Array {
  if (packet.length === PACKET_SIZE + 1 && packet[0] === 0) {
    return packet.slice(1);
  }
  invariant(
    packet.length >= PACKET_SIZE,
    'TRANSPORT_ERROR',
    'Short HID packet',
  );
  return packet.slice(0, PACKET_SIZE);
}

export class HidMessageAssembler {
  private channel?: number;
  private command?: number;
  private length?: number;
  private data?: Uint8Array;
  private offset = 0;
  private sequence = 0;

  add(rawPacket: Uint8Array): HidMessage | undefined {
    const packet = normalizePacket(rawPacket);
    const channel = readU32be(packet, 0);
    if ((packet[4] ?? 0) & 0x80) {
      this.channel = channel;
      this.command = packet[4];
      this.length = readU16be(packet, 5);
      invariant(
        this.length <= MAX_PAYLOAD_SIZE,
        'TRANSPORT_ERROR',
        'CTAPHID response payload is too large',
      );
      this.data = new Uint8Array(this.length);
      const initialLength = Math.min(this.length, INITIAL_DATA_SIZE);
      this.data.set(packet.slice(7, 7 + initialLength));
      this.offset = initialLength;
      this.sequence = 0;
    } else {
      invariant(
        this.channel !== undefined &&
          this.length !== undefined &&
          this.data !== undefined,
        'TRANSPORT_ERROR',
        'Unexpected continuation packet',
      );
      invariant(
        channel === this.channel,
        'TRANSPORT_ERROR',
        'CTAPHID channel changed mid-message',
      );
      invariant(
        packet[4] === this.sequence,
        'TRANSPORT_ERROR',
        'Invalid continuation sequence',
      );
      const chunkLength = Math.min(
        this.length - this.offset,
        CONTINUATION_DATA_SIZE,
      );
      this.data.set(packet.slice(5, 5 + chunkLength), this.offset);
      this.offset += chunkLength;
      this.sequence += 1;
    }
    if (
      this.channel !== undefined &&
      this.command !== undefined &&
      this.length !== undefined &&
      this.data !== undefined &&
      this.offset >= this.length
    ) {
      const result = {
        channel: this.channel,
        command: this.command,
        payload: this.data,
      };
      this.channel = undefined;
      this.command = undefined;
      this.length = undefined;
      this.data = undefined;
      this.offset = 0;
      this.sequence = 0;
      return result;
    }
    return undefined;
  }
}

export class CtapHidTransport implements CtapConnection {
  readonly device: DeviceDescriptor;
  private readonly connection: HidConnection;
  private channel = BROADCAST_CHANNEL;
  private operation = Promise.resolve();

  private constructor(device: DeviceDescriptor, connection: HidConnection) {
    this.device = device;
    this.connection = connection;
  }

  static async open(
    options: {
      provider?: HidProvider;
      deviceId?: string;
      path?: string;
    } = {},
  ): Promise<CtapHidTransport> {
    const provider = options.provider ?? new NodeHidProvider();
    const devices = await listFidoDevices(provider);
    let selected: DeviceDescriptor | undefined;
    if (options.path) {
      selected = devices.find((device) => device.path === options.path);
    } else if (options.deviceId) {
      selected = devices.find((device) => device.id === options.deviceId);
    } else if (devices.length === 1) {
      selected = devices[0];
    } else if (devices.length > 1) {
      throw new CtapError(
        'DEVICE_AMBIGUOUS',
        'Multiple FIDO devices are connected; provide a deviceId',
        { devices: devices.map(({ id, product }) => ({ id, product })) },
      );
    }
    invariant(
      selected,
      'DEVICE_NOT_FOUND',
      'No matching FIDO HID device was found',
    );
    let connection: HidConnection;
    try {
      connection = await provider.open(selected.path);
    } catch (error) {
      throw new CtapError(
        'TRANSPORT_ERROR',
        'Unable to open the FIDO HID device',
        { deviceId: selected.id },
        { cause: error },
      );
    }
    const transport = new CtapHidTransport(selected, connection);
    await transport.initialize();
    return transport;
  }

  async close(): Promise<void> {
    await this.connection.close();
  }

  async cbor(
    command: number,
    request?: Uint8Array,
    timeoutMs = 30_000,
  ): Promise<Uint8Array> {
    return this.exclusive(async () => {
      const response = await this.transact(
        this.channel,
        CTAPHID_CBOR,
        concatBytes(Uint8Array.of(command), request ?? new Uint8Array()),
        timeoutMs,
      );
      const status = response[0];
      invariant(
        status !== undefined,
        'INVALID_RESPONSE',
        'Empty CTAP response',
      );
      if (status !== 0) {
        const statusName = ctapStatusName(status);
        throw new CtapError(
          'CTAP_ERROR',
          `CTAP request failed: ${statusName} (0x${status
            .toString(16)
            .padStart(2, '0')})`,
          { status, statusName },
        );
      }
      return response.slice(1);
    });
  }

  async cancel(): Promise<void> {
    await this.writeMessage({
      channel: this.channel,
      command: CTAPHID_CANCEL,
      payload: new Uint8Array(),
    });
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.operation.then(task, task);
    this.operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async initialize(): Promise<void> {
    const nonce = new Uint8Array(randomBytes(8));
    const response = await this.transact(
      BROADCAST_CHANNEL,
      CTAPHID_INIT,
      nonce,
      5_000,
    );
    invariant(
      response.length >= 17,
      'INVALID_RESPONSE',
      'Short CTAPHID INIT response',
    );
    invariant(
      bytesEqual(response.slice(0, 8), nonce),
      'INVALID_RESPONSE',
      'CTAPHID INIT nonce mismatch',
    );
    this.channel = readU32be(response, 8);
  }

  private async transact(
    channel: number,
    command: number,
    payload: Uint8Array,
    timeoutMs: number,
  ): Promise<Uint8Array> {
    await this.writeMessage({ channel, command, payload });
    const assembler = new HidMessageAssembler();
    let deadline = Date.now() + timeoutMs;
    let lastKeepaliveStatus: number | undefined;
    let receivedPacket = false;
    while (Date.now() < deadline) {
      const packet = await this.connection.read(
        Math.min(250, deadline - Date.now()),
      );
      if (!packet) continue;
      receivedPacket = true;
      const message = assembler.add(packet);
      if (!message || message.channel !== channel) continue;
      if (message.command === CTAPHID_KEEPALIVE) {
        lastKeepaliveStatus = message.payload[0];
        deadline = Date.now() + timeoutMs;
        continue;
      }
      if (message.command === CTAPHID_ERROR) {
        const status = message.payload[0] ?? 0x7f;
        const statusName = ctapHidErrorName(status);
        throw new CtapError(
          'TRANSPORT_ERROR',
          `CTAPHID device returned an error: ${statusName} (0x${status
            .toString(16)
            .padStart(2, '0')})`,
          { status, statusName },
        );
      }
      invariant(
        message.command === command,
        'TRANSPORT_ERROR',
        'Unexpected CTAPHID response command',
      );
      return message.payload;
    }
    await this.cancel().catch(() => undefined);
    const timeoutDetails = {
      deviceId: this.device.id,
      command,
      timeoutMs,
      receivedPacket,
      keepaliveSeen: lastKeepaliveStatus !== undefined,
    };
    if (lastKeepaliveStatus === KEEPALIVE_STATUS_UP_NEEDED) {
      throw new CtapError(
        'USER_PRESENCE_TIMEOUT',
        'Timed out waiting for user presence on the authenticator',
        {
          ...timeoutDetails,
          keepaliveStatus: lastKeepaliveStatus,
          keepaliveStatusName: 'UP_NEEDED',
        },
      );
    }
    throw new CtapError(
      'TRANSPORT_ERROR',
      receivedPacket
        ? 'Authenticator stalled after sending response bytes'
        : 'Timed out before the authenticator returned any response bytes',
      lastKeepaliveStatus === KEEPALIVE_STATUS_PROCESSING
        ? {
            ...timeoutDetails,
            keepaliveStatus: lastKeepaliveStatus,
            keepaliveStatusName: 'PROCESSING',
          }
        : timeoutDetails,
    );
  }

  private async writeMessage(message: HidMessage): Promise<void> {
    for (const packet of encodeHidMessage(message)) {
      await this.connection.write(concatBytes(Uint8Array.of(0), packet));
    }
  }
}
