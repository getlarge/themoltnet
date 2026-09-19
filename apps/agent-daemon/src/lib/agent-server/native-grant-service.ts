/** Process-only native grant. Browser authorization belongs to OperatorOAuth. */
import { createHash, timingSafeEqual } from 'node:crypto';

export const NATIVE_CLIENT_ORIGIN = 'moltnet-agent-desktop://native';
export class NativeGrantError extends Error {
  readonly code = 'native_token_invalid';
}
export class NativeGrantService {
  private digest?: Buffer;
  grantNative(token: string): void {
    if (!token) throw new NativeGrantError('Native token must not be empty');
    this.digest = createHash('sha256').update(token).digest();
  }
  verify(origin: string, token: string): void {
    const digest = createHash('sha256').update(token).digest();
    if (
      origin !== NATIVE_CLIENT_ORIGIN ||
      !this.digest ||
      !timingSafeEqual(this.digest, digest)
    )
      throw new NativeGrantError('Native token is not valid');
  }
}
