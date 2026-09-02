/**
 * One-click pairing ceremony for the serve supervisor, mirroring the signer's
 * session/ceremony pattern (#2062 design):
 *
 *   1. Console (allowed origin) POSTs `/v1/pairings` → pending pairing bound
 *      to that origin, with a one-time confirmation token.
 *   2. Console opens `http://127.0.0.1:<port>/pairings/<id>` in a new tab —
 *      a navigation-gated local approval page naming the origin.
 *   3. One click POSTs the confirmation form (explicit cross-site rejected;
 *      the one-time token is the primary CSRF control).
 *   4. Console claims `/v1/pairings/<id>/claim` from the same origin and
 *      receives the bearer token exactly once; only its SHA-256 remains in
 *      this supervisor process.
 *
 * The token exists for shared-machine cross-user protection and to bind
 * "this console session is the operator" — browser-vs-browser isolation is
 * already covered by the loopback-companion origin checks. Grants are
 * deliberately process-scoped: after the listening socket changes owners, a
 * token disclosed to an impostor on that port cannot authenticate to a later
 * supervisor process.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const PENDING_TTL_MS = 10 * 60 * 1000;

export type ServePairingErrorCode =
  | 'pairing_not_found'
  | 'pairing_expired'
  | 'pairing_invalid'
  | 'pairing_not_approved'
  | 'pairing_origin_mismatch'
  | 'pairing_token_invalid';

export class ServePairingError extends Error {
  override name = 'ServePairingError';
  constructor(
    readonly code: ServePairingErrorCode,
    message: string,
  ) {
    super(message);
  }
}

interface PendingPairing {
  origin: string;
  confirmToken: string;
  expiresAt: number;
  approved: boolean;
  /** Set on approval; handed out exactly once on claim. */
  bearerToken: string | null;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export class PairingService {
  private readonly pending = new Map<string, PendingPairing>();
  private readonly paired = new Map<string, string>();

  constructor(
    private readonly options: {
      now?: () => number;
      randomToken?: () => string;
    } = {},
  ) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private token(): string {
    return (
      this.options.randomToken?.() ?? randomBytes(32).toString('base64url')
    );
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, pairing] of this.pending) {
      if (pairing.expiresAt <= now) this.pending.delete(id);
    }
  }

  start(origin: string): { pairingId: string; approvalPath: string } {
    this.sweep();
    const pairingId = randomBytes(12).toString('hex');
    this.pending.set(pairingId, {
      origin,
      confirmToken: this.token(),
      expiresAt: this.now() + PENDING_TTL_MS,
      approved: false,
      bearerToken: null,
    });
    return { pairingId, approvalPath: `/pairings/${pairingId}` };
  }

  /** Data for the local approval page. */
  approval(pairingId: string): { origin: string; confirmToken: string } {
    const pairing = this.require(pairingId);
    if (pairing.approved) {
      throw new ServePairingError(
        'pairing_invalid',
        'Pairing is already approved',
      );
    }
    return { origin: pairing.origin, confirmToken: pairing.confirmToken };
  }

  confirm(pairingId: string, confirmToken: string): { origin: string } {
    const pairing = this.require(pairingId);
    if (pairing.approved || !safeEqual(pairing.confirmToken, confirmToken)) {
      throw new ServePairingError(
        'pairing_invalid',
        'Confirmation token is not valid',
      );
    }
    pairing.approved = true;
    pairing.bearerToken = this.token();
    return { origin: pairing.origin };
  }

  claim(pairingId: string, origin: string): { token: string } {
    const pairing = this.require(pairingId);
    if (pairing.origin !== origin) {
      throw new ServePairingError(
        'pairing_origin_mismatch',
        'Pairing belongs to a different origin',
      );
    }
    if (!pairing.approved || !pairing.bearerToken) {
      throw new ServePairingError(
        'pairing_not_approved',
        'Pairing has not been approved yet',
      );
    }
    const token = pairing.bearerToken;
    this.pending.delete(pairingId);
    this.paired.set(origin, sha256Hex(token));
    return { token };
  }

  verify(origin: string, token: string): void {
    const tokenHash = this.paired.get(origin);
    if (!tokenHash || !safeEqual(tokenHash, sha256Hex(token))) {
      throw new ServePairingError(
        'pairing_token_invalid',
        'Pairing token is not valid for this origin',
      );
    }
  }

  private require(pairingId: string): PendingPairing {
    this.sweep();
    const pairing = this.pending.get(pairingId);
    if (!pairing) {
      throw new ServePairingError(
        'pairing_not_found',
        'Pairing was not found or has expired',
      );
    }
    return pairing;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Minimal, dependency-free local approval page. */
export function renderPairingApprovalPage(input: {
  pairingId: string;
  origin: string;
  confirmToken: string;
}): string {
  const origin = escapeHtml(input.origin);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MoltNet Agent — approve connection</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; background: Canvas; color: CanvasText; }
  main { max-width: 26rem; padding: 2rem; border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); border-radius: 12px; }
  h1 { font-size: 1.2rem; margin: 0 0 0.5rem; }
  code { font-size: 0.95em; word-break: break-all; }
  button { margin-top: 1.25rem; font: inherit; padding: 0.6rem 1.4rem; border-radius: 8px; border: 1px solid color-mix(in srgb, CanvasText 30%, transparent); cursor: pointer; }
  p.small { font-size: 0.85rem; opacity: 0.75; }
</style>
</head>
<body>
<main>
<h1>Allow this site to manage local MoltNet agents?</h1>
<p><code>${origin}</code> asks to configure agents and start or stop local daemon runs on this machine.</p>
<p class="small">Approve only if you opened that page yourself. This grant lasts until the local supervisor stops.</p>
<form method="post" action="/pairings/${escapeHtml(input.pairingId)}/confirm">
<input type="hidden" name="confirmToken" value="${escapeHtml(input.confirmToken)}" />
<button type="submit">Approve</button>
</form>
</main>
</body>
</html>
`;
}

export function renderPairingResultPage(input: {
  title: string;
  message: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(input.title)}</title>
<style>:root{color-scheme:light dark}body{margin:0;font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;background:Canvas;color:CanvasText}main{max-width:26rem;padding:2rem}</style>
</head>
<body><main role="status"><h1>${escapeHtml(input.title)}</h1><p>${escapeHtml(input.message)}</p><p>You can close this tab.</p></main></body>
</html>
`;
}
