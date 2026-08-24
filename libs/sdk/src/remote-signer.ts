import type {
  AgentIdentity,
  AgentSigningCapability,
} from '@moltnet/crypto-service/agent-signing';

/** Error raised when the signing broker refuses or fails an operation. */
export class RemoteSignerError extends Error {
  override name = 'RemoteSignerError';
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`remote signer ${status}: ${code}`);
  }
}

export const DEFAULT_REMOTE_SIGNER_TIMEOUT_MS = 30_000;
/** Largest broker response we are willing to read (identity or signature). */
export const MAX_REMOTE_SIGNER_RESPONSE_BYTES = 16 * 1024;
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function assertSignerUrl(url: string): URL {
  const parsed = new URL(url);
  // URL.hostname keeps IPv6 brackets ("[::1]"), so strip them before the
  // loopback comparison — otherwise a legitimate http://[::1] fixture is
  // rejected.
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const loopback =
    host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (
    parsed.protocol !== 'https:' &&
    !(parsed.protocol === 'http:' && loopback)
  ) {
    throw new Error(
      'signer url must use https (http is accepted for loopback fixtures only)',
    );
  }
  return parsed;
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function assertIdentity(value: unknown): AgentIdentity {
  const candidate = value as Partial<AgentIdentity> | null;
  if (
    !candidate ||
    !isString(candidate.agentName) ||
    !isString(candidate.identityId) ||
    !isString(candidate.publicKey) ||
    !candidate.publicKey.startsWith('ed25519:') ||
    !isString(candidate.fingerprint) ||
    !isString(candidate.gitName) ||
    !isString(candidate.gitEmail)
  ) {
    throw new RemoteSignerError('invalid_identity', 502);
  }
  return {
    agentName: candidate.agentName,
    identityId: candidate.identityId,
    publicKey: candidate.publicKey,
    fingerprint: candidate.fingerprint,
    gitName: candidate.gitName,
    gitEmail: candidate.gitEmail,
  };
}

async function readBounded(response: Response, limit: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new RemoteSignerError('response_too_large', 502);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(
    Buffer.concat(chunks.map((c) => Buffer.from(c))),
  );
}

/**
 * Guest-side `AgentSigningCapability` backed by a host signing broker
 * (`MOLTNET_SIGNER_URL`). It holds no key material: every operation is a
 * purpose-bound, bounded, validated request to the host, and only the
 * broker's error code reaches the caller.
 */
export async function createRemoteSigner(input: {
  url: string;
  fetch?: typeof fetch;
  /** Per-request deadline (default 30 s). */
  timeoutMs?: number;
  /** Caller cancellation; composed with the per-request deadline. */
  signal?: AbortSignal;
}): Promise<AgentSigningCapability> {
  const base = assertSignerUrl(input.url);
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_REMOTE_SIGNER_TIMEOUT_MS;
  const endpoint = (path: string) => new URL(path, base).toString();

  async function call(path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const onAbort = () => controller.abort(input.signal?.reason);
    if (input.signal?.aborted) onAbort();
    else input.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new Error('timeout')),
      timeoutMs,
    );
    try {
      const response = await fetchImpl(endpoint(path), {
        method: body === undefined ? 'GET' : 'POST',
        signal: controller.signal,
        ...(body !== undefined && {
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        }),
      });
      const text = await readBounded(
        response,
        MAX_REMOTE_SIGNER_RESPONSE_BYTES,
      );
      if (!response.ok) {
        let code = 'request_failed';
        try {
          const payload = JSON.parse(text) as { code?: unknown };
          if (typeof payload.code === 'string') code = payload.code;
        } catch {
          // value-free by construction: keep the generic code
        }
        throw new RemoteSignerError(code, response.status);
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new RemoteSignerError('invalid_response', 502);
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new RemoteSignerError(
          input.signal?.aborted ? 'aborted' : 'timeout',
          504,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
    }
  }

  const identity = assertIdentity(await call('/identity'));

  return {
    identity,
    async signGitCommit({ sshsig }) {
      const out = (await call('/sign-git-commit', {
        sshsig: Buffer.from(sshsig).toString('base64'),
      })) as { signature?: unknown };
      if (!isString(out.signature)) {
        throw new RemoteSignerError('invalid_response', 502);
      }
      const signature = new Uint8Array(Buffer.from(out.signature, 'base64'));
      if (
        signature.length !== 64 ||
        Buffer.from(signature).toString('base64') !== out.signature
      ) {
        throw new RemoteSignerError('invalid_signature', 502);
      }
      return { signature };
    },
    async signDiaryEntry({ signingRequestId }) {
      if (!UUID_RE.test(signingRequestId)) {
        throw new RemoteSignerError('invalid_request', 400);
      }
      const out = (await call('/sign-diary-entry', { signingRequestId })) as {
        signingRequestId?: unknown;
      };
      if (out.signingRequestId !== signingRequestId) {
        throw new RemoteSignerError('invalid_response', 502);
      }
      return { signingRequestId };
    },
  };
}
