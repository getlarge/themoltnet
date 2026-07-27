import {
  colors,
  fontFamily,
  radius,
  shadow,
  transition,
} from '@themoltnet/design-system/tokens';

import type { SignerApprovalDisplay } from './ceremony-service.js';

export function renderApprovalPage(input: {
  ceremonyId: string;
  confirmationToken: string;
  display: SignerApprovalDisplay;
}): string {
  const content = approvalContent(input.display.operation);
  const rows = [
    ['Operation', input.display.operation],
    ['Team', input.display.teamId],
    ['Human signer', input.display.claimantId],
    ['Resource', input.display.resourceId],
    ['Verification method', input.display.verificationMethod],
    ['Audience', input.display.audience],
    ['Expires', input.display.expiresAt],
    ['Signing payload', input.display.signingPayload],
  ].filter((row): row is [string, string] => row[1] !== undefined);
  return page(
    content.title,
    `<main>
      ${brandHeader(content.badge)}
      <div class="intro">
        <h1>${escapeHtml(content.title)}</h1>
        <p class="lede">${escapeHtml(content.lede)}</p>
      </div>
      <section aria-labelledby="action-title">
        <h2 id="action-title">${escapeHtml(content.actionLabel)}</h2>
        <p class="action" data-signing-action>${escapeHtml(input.display.action)}</p>
      </section>
      <section class="binding" aria-labelledby="binding-title">
        <h2 id="binding-title">Cryptographic binding</h2>
        <dl>${rows
          .map(
            ([label, value]) =>
              `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`,
          )
          .join('')}</dl>
      </section>
      <form method="post" action="/ceremonies/${encodeURIComponent(input.ceremonyId)}/confirm">
        <input type="hidden" name="confirmationToken" value="${escapeHtml(input.confirmationToken)}">
        <button type="submit">${escapeHtml(content.buttonLabel)}</button>
      </form>
      <p class="note">${escapeHtml(content.note)}</p>
      ${trustFooter()}
    </main>`,
  );
}

export function renderResultPage(input: {
  title: string;
  message: string;
  success: boolean;
}): string {
  return page(
    input.title,
    `<main>
      ${brandHeader(input.success ? 'Receipt ready' : 'Signing stopped')}
      <div class="intro">
        <h1>${escapeHtml(input.title)}</h1>
        <p class="status ${input.success ? 'success' : 'error'}" role="status">${escapeHtml(input.message)}</p>
      </div>
      <p class="note">Close this window and return to MoltNet Console.</p>
      ${trustFooter()}
    </main>`,
  );
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} · MoltNet Signer</title>
  <style>
    :root{color-scheme:dark;font-family:${fontFamily.sans};background:${colors.bg.void};color:${colors.text.DEFAULT}}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:${colors.bg.void}}
    main{width:min(720px,100%);background:${colors.bg.surface};border-radius:${radius.xl};padding:clamp(24px,5vw,48px);box-shadow:${shadow.lg}}
    .brand{display:flex;align-items:center;justify-content:space-between;gap:20px;padding-bottom:24px;border-bottom:1px solid ${colors.border.DEFAULT}}
    .wordmark{display:flex;align-items:baseline;gap:8px;font-weight:700;letter-spacing:-.02em}.product{color:${colors.text.DEFAULT};font-size:1.25rem}.companion{color:${colors.accent.DEFAULT};font-size:.875rem;font-weight:600}
    .badge{font-size:.75rem;font-weight:600;color:${colors.primary.DEFAULT};background:${colors.primary.muted};padding:6px 10px;border-radius:${radius.full}}
    .intro{margin:40px 0 32px}h1{font-size:clamp(2rem,7vw,3.25rem);line-height:1.05;letter-spacing:-.03em;margin:0 0 16px;max-width:14ch}h2{font-size:.75rem;line-height:1.5;text-transform:uppercase;letter-spacing:.1em;color:${colors.text.secondary};margin:0 0 10px}
    .lede,.note{color:${colors.text.muted};line-height:1.65;max-width:65ch}.action{font-size:clamp(1.25rem,4vw,1.65rem);line-height:1.35;font-weight:700;color:${colors.white};margin:0;padding:20px;background:${colors.bg.elevated};border-radius:${radius.lg};box-shadow:inset 0 0 0 1px ${colors.border.hover}}
    .binding{margin:32px 0 28px}dl{border-top:1px solid ${colors.border.DEFAULT};margin:0}dl div{display:grid;grid-template-columns:minmax(130px,.35fr) 1fr;gap:20px;padding:12px 0;border-bottom:1px solid ${colors.border.DEFAULT}}dt{color:${colors.text.secondary}}dd{margin:0;overflow-wrap:anywhere;font-family:${fontFamily.mono};font-size:.875rem;line-height:1.55;color:${colors.text.DEFAULT}}
    button{width:100%;border:0;border-radius:${radius.md};background:${colors.primary.DEFAULT};color:${colors.text.inverse};padding:15px 20px;font:inherit;font-weight:700;cursor:pointer;transition:background-color ${transition.fast},box-shadow ${transition.fast}}button:hover{background:${colors.primary.hover}}button:focus-visible{outline:0;box-shadow:0 0 0 2px ${colors.bg.void},0 0 0 4px ${colors.border.focus}}
    .status{font-size:1.125rem;line-height:1.6}.success{color:${colors.success.DEFAULT}}.error{color:${colors.error.DEFAULT}}.trust{display:flex;align-items:center;gap:10px;margin:28px 0 0;padding-top:20px;border-top:1px solid ${colors.border.DEFAULT};color:${colors.text.muted};font-size:.75rem;line-height:1.5}.trust-dot{width:7px;height:7px;flex:0 0 auto;border-radius:${radius.full};background:${colors.success.DEFAULT}}
    @media(max-width:520px){body{padding:0}main{min-height:100vh;border-radius:0;padding:24px}.brand{align-items:flex-start;flex-direction:column}.intro{margin-top:32px}dl div{grid-template-columns:1fr;gap:4px}.badge{align-self:flex-start}}
  </style>
</head>
<body>${body}</body>
</html>`;
}

function approvalContent(operation: SignerApprovalDisplay['operation']): {
  actionLabel: string;
  badge: string;
  buttonLabel: string;
  lede: string;
  note: string;
  title: string;
} {
  if (operation === 'credential-enrollment') {
    return {
      actionLabel: 'Credential to create',
      badge: 'Hardware enrollment',
      buttonLabel: 'Enroll this YubiKey',
      lede: 'MoltNet Signer will create a hardware-backed ARKG credential on the connected security key.',
      note: 'You will be asked to touch the key. Closing this window cancels enrollment.',
      title: 'Enroll a MoltNet signing key',
    };
  }
  if (operation === 'credential-registration') {
    return {
      actionLabel: 'Registration proof',
      badge: 'Credential registration',
      buttonLabel: 'Sign registration proof',
      lede: 'Confirm that this hardware credential belongs to the authenticated MoltNet human and team.',
      note: 'You will be asked to touch the key. Closing this window leaves the credential unregistered.',
      title: 'Prove this MoltNet credential',
    };
  }
  return {
    actionLabel: 'Exact MoltNet action',
    badge: 'Hardware approval',
    buttonLabel: 'Sign this exact action',
    lede: 'The security key will sign only MoltNet’s server-owned digest for the action shown below.',
    note: 'You will be asked to touch the key. Closing this window leaves the request unsigned.',
    title: 'Approve a MoltNet action',
  };
}

function brandHeader(badge: string): string {
  return `<header class="brand">
    <div class="wordmark" aria-label="MoltNet Signer">
      <span class="product">MoltNet</span>
      <span class="companion">Signer</span>
    </div>
    <span class="badge">${escapeHtml(badge)}</span>
  </header>`;
}

function trustFooter(): string {
  return `<footer class="trust">
    <span class="trust-dot" aria-hidden="true"></span>
    <span>Local companion · bound to 127.0.0.1 · MoltNet session credentials never enter this app</span>
  </footer>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === '&') return '&amp;';
    if (character === '<') return '&lt;';
    if (character === '>') return '&gt;';
    if (character === '"') return '&quot;';
    return '&#39;';
  });
}
