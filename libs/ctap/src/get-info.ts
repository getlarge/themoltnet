import { asMap, decodeCbor } from './cbor.js';
import { invariant } from './errors.js';
import type { CtapConnection, CtapGetInfo } from './types.js';

const AUTHENTICATOR_GET_INFO = 0x04;

function stringArray(value: unknown, field: string): string[] {
  invariant(
    Array.isArray(value) && value.every((item) => typeof item === 'string'),
    'INVALID_RESPONSE',
    `${field} must be an array of strings`,
  );
  return value;
}

export async function getInfo(
  connection: CtapConnection,
): Promise<CtapGetInfo> {
  const raw = asMap(
    decodeCbor(await connection.cbor(AUTHENTICATOR_GET_INFO)),
    'authenticatorGetInfo response',
  );
  const algorithms = raw.get(0x0a);
  invariant(
    algorithms === undefined || Array.isArray(algorithms),
    'INVALID_RESPONSE',
    'algorithms must be an array',
  );
  return {
    versions: stringArray(raw.get(0x01), 'versions'),
    extensions:
      raw.get(0x02) === undefined
        ? []
        : stringArray(raw.get(0x02), 'extensions'),
    algorithms:
      algorithms?.map((item, index) => {
        const algorithm = asMap(item, `algorithms[${index}]`).get('alg');
        invariant(
          typeof algorithm === 'number',
          'INVALID_RESPONSE',
          `algorithms[${index}].alg must be a number`,
        );
        return algorithm;
      }) ?? [],
    raw,
  };
}
