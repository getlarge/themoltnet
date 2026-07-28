import { describe, expect, it } from 'vitest';

import { u32be } from './bytes.js';
import {
  CtapHidTransport,
  encodeHidMessage,
  type HidConnection,
  HidMessageAssembler,
  type HidProvider,
  listFidoDevices,
} from './ctap-hid.js';
import { CtapError } from './errors.js';

const TEST_CHANNEL = 0x01020304;
const CTAPHID_INIT = 0x86;
const CTAPHID_CBOR = 0x90;
const CTAPHID_KEEPALIVE = 0xbb;
const CTAPHID_ERROR = 0xbf;

type ResponseScenario =
  | 'success-after-keepalive'
  | 'hid-error'
  | 'ctap-error'
  | 'presence-timeout'
  | 'processing-timeout'
  | 'read-timeout';

async function captureCtapError(
  operation: () => Promise<unknown>,
): Promise<CtapError> {
  try {
    await operation();
    throw new Error('Expected CTAP operation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(CtapError);
    if (!(error instanceof CtapError)) throw error;
    return error;
  }
}

function scriptedProvider(
  options: {
    initNonceMismatch?: boolean;
    scenario?: ResponseScenario;
  } = {},
): HidProvider {
  const reads: Uint8Array[] = [];
  const connection: HidConnection = {
    async write(report) {
      const packet = report.slice(1);
      const command = packet[4];
      const payloadLength = (packet[5] << 8) | packet[6];
      const payload = packet.slice(7, 7 + payloadLength);
      if (command === CTAPHID_INIT) {
        const nonce = Uint8Array.from(payload);
        if (options.initNonceMismatch) {
          nonce[0] ^= 0xff;
        }
        reads.push(
          ...encodeHidMessage({
            channel: 0xffffffff,
            command: CTAPHID_INIT,
            payload: new Uint8Array([
              ...nonce,
              ...u32be(TEST_CHANNEL),
              2,
              1,
              0,
              0,
              0,
            ]),
          }),
        );
      } else if (command === CTAPHID_CBOR) {
        if (options.scenario === 'success-after-keepalive') {
          reads.push(
            ...encodeHidMessage({
              channel: TEST_CHANNEL,
              command: CTAPHID_KEEPALIVE,
              payload: Uint8Array.of(0x01),
            }),
            ...encodeHidMessage({
              channel: TEST_CHANNEL,
              command: CTAPHID_CBOR,
              payload: Uint8Array.of(0x00, 0x09),
            }),
          );
        } else if (options.scenario === 'hid-error') {
          reads.push(
            ...encodeHidMessage({
              channel: TEST_CHANNEL,
              command: CTAPHID_ERROR,
              payload: Uint8Array.of(0x06),
            }),
          );
        } else if (options.scenario === 'ctap-error') {
          reads.push(
            ...encodeHidMessage({
              channel: TEST_CHANNEL,
              command: CTAPHID_CBOR,
              payload: Uint8Array.of(0x36),
            }),
          );
        } else if (options.scenario === 'presence-timeout') {
          reads.push(
            ...encodeHidMessage({
              channel: TEST_CHANNEL,
              command: CTAPHID_KEEPALIVE,
              payload: Uint8Array.of(0x02),
            }),
          );
        } else if (options.scenario === 'processing-timeout') {
          reads.push(
            ...encodeHidMessage({
              channel: TEST_CHANNEL,
              command: CTAPHID_KEEPALIVE,
              payload: Uint8Array.of(0x01),
            }),
          );
        }
      }
      return report.length;
    },
    async read() {
      return reads.shift();
    },
    async close() {},
  };
  return {
    async devices() {
      return [
        {
          path: '/fido',
          vendorId: 0x1050,
          productId: 1,
          usagePage: 0xf1d0,
          usage: 1,
        },
      ];
    },
    async open() {
      return connection;
    },
  };
}

describe('CTAPHID framing', () => {
  it('encodes initial and continuation packets', () => {
    const payload = Uint8Array.from({ length: 180 }, (_, index) => index);
    const packets = encodeHidMessage({
      channel: TEST_CHANNEL,
      command: CTAPHID_CBOR,
      payload,
    });

    expect(packets).toHaveLength(4);
    expect([...packets[0].slice(0, 7)]).toEqual([1, 2, 3, 4, 0x90, 0, 180]);
    expect(packets[1][4]).toBe(0);
    expect(packets[2][4]).toBe(1);
    expect(packets[3][4]).toBe(2);
  });

  it('reassembles a multi-packet response', () => {
    const payload = Uint8Array.from({ length: 180 }, (_, index) => index);
    const assembler = new HidMessageAssembler();
    const results = encodeHidMessage({
      channel: TEST_CHANNEL,
      command: CTAPHID_CBOR,
      payload,
    }).map((packet) => assembler.add(packet));

    expect(results.slice(0, -1).every((result) => result === undefined)).toBe(
      true,
    );
    expect(results.at(-1)).toEqual({
      channel: TEST_CHANNEL,
      command: CTAPHID_CBOR,
      payload,
    });
  });

  it('rejects continuation packets from another channel', () => {
    const packets = encodeHidMessage({
      channel: TEST_CHANNEL,
      command: CTAPHID_CBOR,
      payload: new Uint8Array(100),
    });
    const assembler = new HidMessageAssembler();
    assembler.add(packets[0]);
    const wrongChannel = Uint8Array.from(packets[1]);
    wrongChannel.set(u32be(0x05060708), 0);

    expect(() => assembler.add(wrongChannel)).toThrow(/channel changed/i);
  });

  it('rejects invalid continuation sequences', () => {
    const packets = encodeHidMessage({
      channel: TEST_CHANNEL,
      command: CTAPHID_CBOR,
      payload: new Uint8Array(100),
    });
    const assembler = new HidMessageAssembler();
    assembler.add(packets[0]);
    const invalidSequence = Uint8Array.from(packets[1]);
    invalidSequence[4] = 1;

    expect(() => assembler.add(invalidSequence)).toThrow(
      /continuation sequence/i,
    );
  });

  it('filters non-FIDO HID devices and returns stable selectors', async () => {
    const provider: HidProvider = {
      async devices() {
        return [
          {
            path: '/fido',
            vendorId: 0x1050,
            productId: 1,
            usagePage: 0xf1d0,
            usage: 1,
          },
          {
            path: '/keyboard',
            vendorId: 1,
            productId: 2,
            usagePage: 1,
            usage: 6,
          },
        ];
      },
      async open() {
        throw new Error('not used');
      },
    };

    const first = await listFidoDevices(provider);
    const second = await listFidoDevices(provider);

    expect(first).toHaveLength(1);
    expect(first[0]?.path).toBe('/fido');
    expect(first[0]?.id).toBe(second[0]?.id);
  });

  it('rejects an INIT response with a different nonce', async () => {
    await expect(
      CtapHidTransport.open({
        provider: scriptedProvider({ initNonceMismatch: true }),
      }),
    ).rejects.toThrow(/INIT nonce mismatch/);
  });

  it('ignores KEEPALIVE frames and returns the following CBOR response', async () => {
    const transport = await CtapHidTransport.open({
      provider: scriptedProvider({ scenario: 'success-after-keepalive' }),
    });

    await expect(transport.cbor(0x04)).resolves.toEqual(Uint8Array.of(0x09));
    await transport.close();
  });

  it('surfaces CTAPHID error frames', async () => {
    const transport = await CtapHidTransport.open({
      provider: scriptedProvider({ scenario: 'hid-error' }),
    });

    await expect(transport.cbor(0x04)).rejects.toMatchObject({
      code: 'TRANSPORT_ERROR',
      details: { status: 0x06, statusName: 'CHANNEL_BUSY' },
    });
    await transport.close();
  });

  it('names non-zero CTAP status codes', async () => {
    const transport = await CtapHidTransport.open({
      provider: scriptedProvider({ scenario: 'ctap-error' }),
    });

    await expect(transport.cbor(0x04)).rejects.toMatchObject({
      code: 'CTAP_ERROR',
      details: { status: 0x36, statusName: 'PIN_REQUIRED' },
    });
    await transport.close();
  });

  it('distinguishes a user-presence timeout', async () => {
    const transport = await CtapHidTransport.open({
      provider: scriptedProvider({ scenario: 'presence-timeout' }),
    });

    const error = await captureCtapError(() =>
      transport.cbor(0x04, undefined, 2),
    );
    expect(error).toMatchObject({
      code: 'USER_PRESENCE_TIMEOUT',
      details: {
        command: CTAPHID_CBOR,
        timeoutMs: 2,
        receivedPacket: true,
        keepaliveSeen: true,
        keepaliveStatusName: 'UP_NEEDED',
      },
    });
    expect(typeof error.details?.deviceId).toBe('string');
    await transport.close();
  });

  it('distinguishes a stalled operation after a processing keepalive', async () => {
    const transport = await CtapHidTransport.open({
      provider: scriptedProvider({ scenario: 'processing-timeout' }),
    });

    const error = await captureCtapError(() =>
      transport.cbor(0x04, undefined, 2),
    );
    expect(error).toMatchObject({
      code: 'TRANSPORT_ERROR',
      details: {
        command: CTAPHID_CBOR,
        timeoutMs: 2,
        receivedPacket: true,
        keepaliveSeen: true,
        keepaliveStatusName: 'PROCESSING',
      },
    });
    expect(typeof error.details?.deviceId).toBe('string');
    await transport.close();
  });

  it('identifies a timeout where no response bytes were read', async () => {
    const transport = await CtapHidTransport.open({
      provider: scriptedProvider({ scenario: 'read-timeout' }),
    });

    const error = await captureCtapError(() =>
      transport.cbor(0x04, undefined, 2),
    );
    expect(error).toMatchObject({
      code: 'TRANSPORT_ERROR',
      details: {
        command: CTAPHID_CBOR,
        timeoutMs: 2,
        receivedPacket: false,
        keepaliveSeen: false,
      },
    });
    expect(typeof error.details?.deviceId).toBe('string');
    await transport.close();
  });
});
