import { describe, expect, it, vi } from 'vitest';

import { createRemoteSigner, RemoteSignerError } from '../src/remote-signer.js';

const ORIGIN = 'https://agent-signing.moltnet.internal';
const identity = {
  agentName: 'legreffier',
  identityId: 'id',
  publicKey: 'ed25519:wBkbENwyQSOnY+OZIsVX1F3b35JvQ42juWDXyqTapN4=',
  fingerprint: '1671-B080-99BF-4270',
  gitName: 'LeGreffier',
  gitEmail: 'l@x',
};

function fakeFetch(
  routes: Record<string, (body: unknown) => { status: number; body: unknown }>,
) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetchImpl = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method: init?.method ?? 'GET', body });
      const route = routes[new URL(url).pathname];
      if (!route) return new Response('{}', { status: 404 });
      const result = route(body);
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { 'content-type': 'application/json' },
      });
    },
  );
  return { fetchImpl, calls };
}

describe('createRemoteSigner', () => {
  it('loads the identity once and exposes it', async () => {
    const { fetchImpl, calls } = fakeFetch({
      '/identity': () => ({ status: 200, body: identity }),
    });
    const signer = await createRemoteSigner({ url: ORIGIN, fetch: fetchImpl });
    expect(signer.identity).toEqual(identity);
    expect(calls).toEqual([
      { url: `${ORIGIN}/identity`, method: 'GET', body: undefined },
    ]);
  });

  it('signs a git envelope through sign-git-commit and decodes the signature', async () => {
    const raw = new Uint8Array(64).fill(3);
    const { fetchImpl, calls } = fakeFetch({
      '/identity': () => ({ status: 200, body: identity }),
      '/sign-git-commit': () => ({
        status: 200,
        body: { signature: Buffer.from(raw).toString('base64') },
      }),
    });
    const signer = await createRemoteSigner({ url: ORIGIN, fetch: fetchImpl });
    const envelope = new Uint8Array([1, 2, 3]);
    const { signature } = await signer.signGitCommit({ sshsig: envelope });
    expect(signature).toEqual(raw);
    expect(calls[1]).toEqual({
      url: `${ORIGIN}/sign-git-commit`,
      method: 'POST',
      body: { sshsig: Buffer.from(envelope).toString('base64') },
    });
  });

  it('posts the signing request id for diary entries', async () => {
    const { fetchImpl, calls } = fakeFetch({
      '/identity': () => ({ status: 200, body: identity }),
      '/sign-diary-entry': (body) => ({ status: 200, body }),
    });
    const signer = await createRemoteSigner({ url: ORIGIN, fetch: fetchImpl });
    const id = '2f1c0b9e-1111-4222-8333-444455556666';
    await expect(
      signer.signDiaryEntry({ signingRequestId: id }),
    ).resolves.toEqual({ signingRequestId: id });
    expect(calls[1]?.body).toEqual({ signingRequestId: id });
  });

  it('surfaces the broker error code without leaking the response body into the message', async () => {
    const { fetchImpl } = fakeFetch({
      '/identity': () => ({ status: 200, body: identity }),
      '/sign-git-commit': () => ({
        status: 403,
        body: {
          code: 'host_capability_denied',
          message: 'grant missing: secret-hint',
        },
      }),
    });
    const signer = await createRemoteSigner({ url: ORIGIN, fetch: fetchImpl });
    const error = await signer
      .signGitCommit({ sshsig: new Uint8Array([1]) })
      .then(
        () => {
          throw new Error('expected rejection');
        },
        (e: unknown) => e as RemoteSignerError,
      );
    expect(error).toBeInstanceOf(RemoteSignerError);
    expect(error).toMatchObject({
      code: 'host_capability_denied',
      status: 403,
    });
    expect(error.message).toContain('host_capability_denied');
    expect(error.message).not.toContain('secret-hint');
  });

  it('validates identity and signature responses and bounds their size', async () => {
    const badIdentity = fakeFetch({
      '/identity': () => ({ status: 200, body: { agentName: 'a' } }),
    });
    await expect(
      createRemoteSigner({ url: ORIGIN, fetch: badIdentity.fetchImpl }),
    ).rejects.toMatchObject({ code: 'invalid_identity' });

    const shortSig = fakeFetch({
      '/identity': () => ({ status: 200, body: identity }),
      '/sign-git-commit': () => ({
        status: 200,
        body: { signature: Buffer.alloc(10).toString('base64') },
      }),
    });
    const signer = await createRemoteSigner({
      url: ORIGIN,
      fetch: shortSig.fetchImpl,
    });
    await expect(
      signer.signGitCommit({ sshsig: new Uint8Array([1]) }),
    ).rejects.toMatchObject({ code: 'invalid_signature' });
    await expect(
      signer.signDiaryEntry({ signingRequestId: 'not-a-uuid' }),
    ).rejects.toMatchObject({ code: 'invalid_request' });

    const mismatched = fakeFetch({
      '/identity': () => ({ status: 200, body: identity }),
      '/sign-diary-entry': () => ({
        status: 200,
        body: { signingRequestId: '00000000-0000-4000-8000-000000000000' },
      }),
    });
    const signer2 = await createRemoteSigner({
      url: ORIGIN,
      fetch: mismatched.fetchImpl,
    });
    await expect(
      signer2.signDiaryEntry({
        signingRequestId: '2f1c0b9e-1111-4222-8333-444455556666',
      }),
    ).rejects.toMatchObject({ code: 'invalid_response' });

    const huge = fakeFetch({
      '/identity': () => ({
        status: 200,
        body: { ...identity, gitName: 'x'.repeat(40_000) },
      }),
    });
    await expect(
      createRemoteSigner({ url: ORIGIN, fetch: huge.fetchImpl }),
    ).rejects.toMatchObject({ code: 'response_too_large' });
  });

  it('times out and honours caller abort', async () => {
    const hang = vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    await expect(
      createRemoteSigner({ url: ORIGIN, fetch: hang as never, timeoutMs: 20 }),
    ).rejects.toMatchObject({ code: 'timeout', status: 504 });
    const controller = new AbortController();
    const pending = createRemoteSigner({
      url: ORIGIN,
      fetch: hang as never,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });

  it('rejects non-https signer URLs that are not loopback', async () => {
    await expect(
      createRemoteSigner({ url: 'http://signer.example.com', fetch: vi.fn() }),
    ).rejects.toThrow(/https/);
  });

  it('accepts an http IPv6 loopback fixture (bracketed hostname)', async () => {
    const { fetchImpl } = fakeFetch({
      '/identity': () => ({ status: 200, body: identity }),
    });
    const signer = await createRemoteSigner({
      url: 'http://[::1]:8791',
      fetch: fetchImpl,
    });
    expect(signer.identity).toEqual(identity);
  });
});
