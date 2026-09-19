import type { NativeGrantService } from './native-grant-service.js';

/**
 * Environment variable the supervising desktop app uses to hand this server
 * process its control token.
 *
 * The parent generates the token, passes it here, and keeps it in native
 * memory — it is never written to disk, never printed to stdout (the desktop
 * app surfaces server output in its WebView), and never reaches the renderer.
 */
export const NATIVE_TOKEN_ENV = 'MOLTNET_AGENT_SERVER_NATIVE_TOKEN';

/** 32 bytes of entropy, base64url-encoded, is 43 characters. */
const MIN_TOKEN_LENGTH = 32;

/**
 * Consume the supervisor's native token from the environment and grant it.
 *
 * Consuming matters as much as granting: spawned run children inherit this
 * process environment, so a token left in place would hand every
 * task-executing agent control of the Agent Server supervising it. The
 * variable is deleted whether or not the value turns out to be usable.
 *
 * @returns whether a native grant was issued.
 */
export function applyNativeClientGrant(options: {
  pairing: NativeGrantService;
  env: NodeJS.ProcessEnv;
}): boolean {
  const { pairing, env } = options;
  const token = env[NATIVE_TOKEN_ENV];
  delete env[NATIVE_TOKEN_ENV];
  if (typeof token !== 'string' || token.length === 0) return false;
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `${NATIVE_TOKEN_ENV} must be at least 32 characters of unguessable entropy`,
    );
  }
  pairing.grantNative(token);
  return true;
}
