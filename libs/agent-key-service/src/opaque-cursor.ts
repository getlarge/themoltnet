export function encodeOpaqueCursor(payload: object): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeOpaqueCursor<T>(
  cursor: string,
  isValid: (value: unknown) => value is T,
): T | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as unknown;
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
