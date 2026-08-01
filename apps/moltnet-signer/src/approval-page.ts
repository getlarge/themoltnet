/**
 * THESIS: Make delegated authority visible as a short local ceremony, refusing
 * the generic centered security prompt.
 * OWN-WORLD: Matte control-plane surfaces, network teal for request movement,
 * and identity amber only for hardware-backed approval.
 * STORY: Review the exact action, inspect its binding, then authorize one
 * YubiKey touch without exposing MoltNet session credentials.
 * FIRST VIEWPORT: A three-stage authority corridor leads into a split action
 * review and cryptographic envelope, with one anchored confirmation action.
 * FORM: Authority corridor, the seventh grounded Operate structure; seed
 * b98e8592.
 */
import {
  colors,
  fontFamily,
  lightColors,
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
    `<a class="skip-link" href="#approval">Skip to approval</a>
    <div class="app-shell">
      ${brandHeader(content.badge)}
      ${ceremonyRail()}
      <main id="approval" class="ceremony-layout" tabindex="-1">
        <section class="decision" aria-labelledby="approval-title">
          <div class="decision-copy">
            <p class="kicker">Human authorization required</p>
            <h1 id="approval-title">${escapeHtml(content.title)}</h1>
            <p class="lede">${escapeHtml(content.lede)}</p>
          </div>

          <div class="action-review" aria-labelledby="action-title">
            <div class="section-heading">
              <h2 id="action-title">${escapeHtml(content.actionLabel)}</h2>
              <span>Review exactly</span>
            </div>
            <p class="action" data-signing-action>${escapeHtml(input.display.action)}</p>
          </div>

        </section>

        <aside class="binding" aria-labelledby="binding-title">
          <div class="binding-header">
            <div>
              <p class="kicker">Authority envelope</p>
              <h2 id="binding-title">Cryptographic binding</h2>
            </div>
            <span class="binding-state"><span aria-hidden="true"></span>Server prepared</span>
          </div>
          <p class="binding-intro">These values are bound to the digest sent to the security key. Confirm only if they match the action you expect.</p>
          <dl>${rows.map(([label, value]) => bindingRow(label, value)).join('')}</dl>
        </aside>

        <section class="confirmation" aria-labelledby="confirmation-title">
          <div class="confirmation-copy">
            <p class="kicker">Final authorization</p>
            <h2 id="confirmation-title">One touch. Only this digest.</h2>
            <p class="note">${escapeHtml(content.note)}</p>
          </div>
          <form method="post" action="/ceremonies/${encodeURIComponent(input.ceremonyId)}/confirm">
            <input type="hidden" name="confirmationToken" value="${escapeHtml(input.confirmationToken)}">
            <button type="submit">
              <span>${escapeHtml(content.buttonLabel)}</span>
              <span class="button-hint" aria-hidden="true">Touch required</span>
            </button>
          </form>
        </section>
      </main>
      ${trustFooter()}
    </div>`,
  );
}

export function renderResultPage(input: {
  title: string;
  message: string;
  success: boolean;
}): string {
  return page(
    input.title,
    `<div class="app-shell result-shell">
      ${brandHeader(input.success ? 'Receipt ready' : 'Signing stopped')}
      <main id="result" class="result-layout" tabindex="-1">
        <div class="result-mark ${input.success ? 'is-success' : 'is-error'}" aria-hidden="true">${input.success ? '✓' : '×'}</div>
        <div class="result-copy">
          <p class="kicker">${input.success ? 'Ceremony complete' : 'Ceremony interrupted'}</p>
          <h1>${escapeHtml(input.title)}</h1>
          <p class="status ${input.success ? 'success' : 'error'}" role="status">${escapeHtml(input.message)}</p>
          <p class="note">Close this window and return to MoltNet Console.</p>
        </div>
      </main>
      ${trustFooter()}
    </div>`,
  );
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="${colors.bg.void}">
  <title>${escapeHtml(title)} · MoltNet Signer</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: ${fontFamily.sans};
      --void: ${colors.bg.void};
      --surface: ${colors.bg.surface};
      --elevated: ${colors.bg.elevated};
      --overlay: ${colors.bg.overlay};
      --network: ${colors.primary.DEFAULT};
      --network-hover: ${colors.primary.hover};
      --network-muted: ${colors.primary.muted};
      --identity: ${colors.accent.DEFAULT};
      --identity-hover: ${colors.accent.hover};
      --identity-muted: ${colors.accent.muted};
      --text: ${colors.text.DEFAULT};
      --text-secondary: ${colors.text.secondary};
      --text-muted: ${colors.text.muted};
      --text-inverse: ${colors.text.inverse};
      --border: ${colors.border.DEFAULT};
      --border-hover: ${colors.border.hover};
      --focus: ${colors.border.focus};
      --success: ${colors.success.DEFAULT};
      --success-muted: ${colors.success.muted};
      --error: ${colors.error.DEFAULT};
      --error-muted: ${colors.error.muted};
    }
    * { box-sizing: border-box; }
    html { min-width: 320px; background: var(--void); }
    body {
      margin: 0;
      min-height: 100vh;
      padding: clamp(16px, 3vw, 40px);
      background: var(--void);
      color: var(--text);
    }
    body::before {
      content: '';
      position: fixed;
      inset: 0 0 auto;
      height: 3px;
      background: linear-gradient(90deg, var(--network) 0 62%, var(--identity) 62% 100%);
    }
    .skip-link {
      position: fixed;
      z-index: 10;
      top: 12px;
      left: 12px;
      transform: translateY(-150%);
      padding: 10px 14px;
      border-radius: ${radius.md};
      background: var(--network);
      color: var(--text-inverse);
      font-weight: 700;
    }
    .skip-link:focus { transform: translateY(0); }
    .app-shell {
      width: min(1180px, 100%);
      margin: 0 auto;
      overflow: hidden;
      border-radius: ${radius.xl};
      background: var(--surface);
      box-shadow: ${shadow.lg};
    }
    .brand {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      min-height: 72px;
      padding: 16px clamp(20px, 4vw, 48px);
      border-bottom: 1px solid var(--border);
    }
    .wordmark { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .brand-mark {
      display: block;
      width: 34px;
      height: 34px;
      flex: 0 0 auto;
    }
    .product { font-size: 1rem; font-weight: 750; letter-spacing: -0.02em; }
    .companion { color: var(--text-muted); font-size: .8125rem; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      border-radius: ${radius.full};
      background: var(--identity-muted);
      color: var(--identity);
      font-size: .75rem;
      font-weight: 700;
      white-space: nowrap;
    }
    .badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .ceremony-rail { padding: 0 clamp(20px, 4vw, 48px); border-bottom: 1px solid var(--border); }
    .ceremony-rail ol { display: grid; grid-template-columns: repeat(3, 1fr); margin: 0; padding: 0; list-style: none; }
    .ceremony-rail li {
      position: relative;
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr);
      gap: 10px;
      align-items: center;
      min-height: 82px;
      padding: 16px 28px 16px 0;
      color: var(--text-muted);
    }
    .ceremony-rail li:not(:last-child)::after {
      content: '';
      position: absolute;
      top: 50%;
      right: 12px;
      width: 20px;
      height: 1px;
      background: var(--border-hover);
    }
    .step-index {
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border: 1px solid var(--border-hover);
      border-radius: 50%;
      font: 600 .6875rem/1 ${fontFamily.mono};
    }
    .step-copy { min-width: 0; }
    .step-copy strong, .step-copy span { display: block; }
    .step-copy strong { color: var(--text-secondary); font-size: .8125rem; }
    .step-copy span { margin-top: 3px; font-size: .6875rem; }
    .ceremony-rail .is-complete .step-index { border-color: var(--network); background: var(--network-muted); color: var(--network); }
    .ceremony-rail .is-current .step-index { border-color: var(--identity); background: var(--identity-muted); color: var(--identity); }
    .ceremony-rail .is-current strong { color: var(--text); }
    .ceremony-layout {
      display: grid;
      grid-template-columns: minmax(0, 1.08fr) minmax(330px, .92fr);
      min-width: 0;
      outline: none;
    }
    .decision { min-width: 0; padding: clamp(32px, 5vw, 64px) clamp(24px, 5vw, 64px); }
    .decision-copy { max-width: 650px; }
    .kicker {
      margin: 0 0 10px;
      color: var(--identity);
      font-size: .75rem;
      font-weight: 700;
      letter-spacing: .04em;
    }
    h1 {
      max-width: 15ch;
      margin: 0;
      font-size: clamp(2.25rem, 5vw, 4.25rem);
      line-height: .98;
      letter-spacing: -.035em;
      text-wrap: balance;
    }
    .lede { max-width: 62ch; margin: 20px 0 0; color: var(--text-secondary); font-size: 1rem; line-height: 1.7; }
    .action-review { margin-top: clamp(36px, 5vw, 56px); }
    .section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
    .section-heading h2, .binding h2, .confirmation h2 { margin: 0; color: var(--text); font-size: .9375rem; line-height: 1.4; }
    .section-heading span { color: var(--text-muted); font-size: .75rem; }
    .action {
      margin: 0;
      padding: clamp(20px, 3vw, 28px);
      border: 1px solid var(--border-hover);
      border-radius: ${radius.lg};
      background: var(--elevated);
      color: var(--text);
      font-size: clamp(1.15rem, 2.5vw, 1.6rem);
      font-weight: 650;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }
    form { margin: 0; }
    button {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      width: 100%;
      min-height: 58px;
      padding: 14px 18px;
      border: 0;
      border-radius: ${radius.md};
      background: var(--identity);
      color: var(--text-inverse);
      font: 750 1rem/1.3 ${fontFamily.sans};
      cursor: pointer;
      transition: background-color ${transition.fast}, transform ${transition.fast};
    }
    button:hover { background: var(--identity-hover); }
    button:active { transform: translateY(1px); }
    button:focus-visible { outline: 3px solid var(--void); box-shadow: 0 0 0 5px var(--focus); }
    .button-hint { font-size: .6875rem; font-weight: 700; opacity: .72; }
    .note { margin: 14px 0 0; color: var(--text-muted); font-size: .8125rem; line-height: 1.6; }
    .binding { min-width: 0; padding: clamp(32px, 4vw, 48px); background: var(--void); }
    .binding-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
    .binding-state { display: inline-flex; align-items: center; gap: 7px; color: var(--network); font-size: .6875rem; white-space: nowrap; }
    .binding-state span { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .binding-intro { max-width: 52ch; margin: 20px 0 28px; color: var(--text-secondary); font-size: .8125rem; line-height: 1.65; }
    dl { margin: 0; }
    dl div { padding: 14px 0; border-top: 1px solid var(--border); }
    dl div:last-child { border-bottom: 1px solid var(--border); }
    dt { color: var(--text-muted); font-size: .6875rem; line-height: 1.4; }
    dd { margin: 6px 0 0; color: var(--text); font: 500 .75rem/1.55 ${fontFamily.mono}; overflow-wrap: anywhere; }
    .confirmation {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(340px, .8fr);
      gap: clamp(24px, 5vw, 64px);
      align-items: center;
      padding: 24px clamp(24px, 5vw, 64px);
      border-top: 1px solid var(--border);
      background: var(--surface);
    }
    .confirmation-copy { min-width: 0; }
    .confirmation .note { margin-top: 8px; }
    .trust {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0;
      margin: 0;
      border-top: 1px solid var(--border);
      background: var(--surface);
    }
    .trust div { display: flex; gap: 10px; min-width: 0; padding: 18px clamp(20px, 3vw, 34px); }
    .trust div:not(:last-child) { border-right: 1px solid var(--border); }
    .trust strong, .trust span { display: block; }
    .trust strong { color: var(--text-secondary); font-size: .75rem; }
    .trust span { margin-top: 3px; color: var(--text-muted); font-size: .6875rem; line-height: 1.45; }
    .trust-icon { flex: 0 0 auto; width: 8px; height: 8px; margin-top: 4px; border: 1px solid var(--network); border-radius: 50%; }
    .trust div:last-child .trust-icon { border-color: var(--identity); }
    .result-shell { max-width: 840px; }
    .result-layout { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 28px; align-items: start; padding: clamp(42px, 7vw, 84px); outline: none; }
    .result-mark { display: grid; place-items: center; width: 58px; height: 58px; border-radius: 50%; font-size: 1.5rem; font-weight: 700; }
    .result-mark.is-success { background: var(--success-muted); color: var(--success); }
    .result-mark.is-error { background: var(--error-muted); color: var(--error); }
    .result-copy h1 { font-size: clamp(2.25rem, 6vw, 4rem); }
    .status { max-width: 58ch; margin: 22px 0 0; font-size: 1.0625rem; line-height: 1.65; }
    .success { color: var(--success); }
    .error { color: var(--error); }

    @media (prefers-color-scheme: light) {
      :root {
        color-scheme: light;
        --void: ${lightColors.bg.void};
        --surface: ${lightColors.bg.surface};
        --elevated: ${lightColors.bg.elevated};
        --overlay: ${lightColors.bg.overlay};
        --network: ${lightColors.primary.DEFAULT};
        --network-hover: ${lightColors.primary.hover};
        --network-muted: ${lightColors.primary.muted};
        --identity: ${lightColors.accent.DEFAULT};
        --identity-hover: ${lightColors.accent.hover};
        --identity-muted: ${lightColors.accent.muted};
        --text: ${lightColors.text.DEFAULT};
        --text-secondary: ${lightColors.text.secondary};
        --text-muted: ${lightColors.text.muted};
        --text-inverse: ${lightColors.text.inverse};
        --border: ${lightColors.border.DEFAULT};
        --border-hover: ${lightColors.border.hover};
        --focus: ${lightColors.border.focus};
        --success: ${lightColors.success.DEFAULT};
        --success-muted: ${lightColors.success.muted};
        --error: ${lightColors.error.DEFAULT};
        --error-muted: ${lightColors.error.muted};
      }
      .app-shell { box-shadow: 0 12px 34px rgba(26, 26, 46, .12); }
    }
    @media (max-width: 820px) {
      body { padding: 0; }
      body::before { position: absolute; }
      .app-shell { min-height: 100vh; border-radius: 0; box-shadow: none; }
      .brand { min-height: 68px; }
      .ceremony-rail ol { grid-template-columns: 1fr; padding: 12px 0; }
      .ceremony-rail li { min-height: auto; padding: 8px 0; }
      .ceremony-rail li:not(:last-child)::after { top: auto; right: auto; bottom: -5px; left: 12px; width: 1px; height: 10px; }
      .ceremony-layout { grid-template-columns: 1fr; }
      .binding { border-top: 1px solid var(--border); }
      .confirmation { grid-template-columns: 1fr; }
      .trust { grid-template-columns: 1fr; }
      .trust div:not(:last-child) { border-right: 0; border-bottom: 1px solid var(--border); }
    }
    @media (max-width: 520px) {
      .brand { align-items: flex-start; flex-direction: column; gap: 12px; }
      .badge { align-self: flex-start; }
      .binding-header, .section-heading { align-items: flex-start; flex-direction: column; gap: 8px; }
      .result-layout { grid-template-columns: 1fr; gap: 22px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; }
    }
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
      lede: 'Create a hardware-backed ARKG credential on the security key connected to this machine.',
      note: 'Closing this window cancels enrollment. No credential will be created.',
      title: 'Enroll a MoltNet signing key',
    };
  }
  if (operation === 'credential-registration') {
    return {
      actionLabel: 'Registration proof',
      badge: 'Credential registration',
      buttonLabel: 'Sign registration proof',
      lede: 'Bind this hardware credential to the authenticated MoltNet human and team.',
      note: 'Closing this window leaves the credential unregistered.',
      title: 'Prove this MoltNet credential',
    };
  }
  return {
    actionLabel: 'Exact MoltNet action',
    badge: 'Hardware approval',
    buttonLabel: 'Sign this exact action',
    lede: 'Authorize only the server-owned digest for the action shown below.',
    note: 'Closing this window leaves the request unsigned.',
    title: 'Approve a MoltNet action',
  };
}

function brandHeader(badge: string): string {
  return `<header class="brand">
    <div class="wordmark" aria-label="MoltNet Signer">
      ${brandMark()}
      <span class="product">MoltNet</span>
      <span class="companion">Local signer</span>
    </div>
    <span class="badge">${escapeHtml(badge)}</span>
  </header>`;
}

function ceremonyRail(): string {
  return `<section class="ceremony-rail" aria-label="Signing ceremony progress">
    <ol>
      <li class="is-complete">
        <span class="step-index" aria-hidden="true">01</span>
        <span class="step-copy"><strong>Console request</strong><span>Received over loopback</span></span>
      </li>
      <li class="is-current" aria-current="step">
        <span class="step-index" aria-hidden="true">02</span>
        <span class="step-copy"><strong>Local review</strong><span>Confirm the exact action</span></span>
      </li>
      <li>
        <span class="step-index" aria-hidden="true">03</span>
        <span class="step-copy"><strong>YubiKey signature</strong><span>Touch follows approval</span></span>
      </li>
    </ol>
  </section>`;
}

function brandMark(): string {
  return `<svg class="brand-mark" viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <circle cx="24" cy="24" r="17" stroke="var(--network)" stroke-width="3" stroke-linecap="round" stroke-dasharray="83 24" transform="rotate(-52 24 24)" />
    <circle cx="24" cy="24" r="12.5" stroke="var(--network)" stroke-width=".5" stroke-dasharray="2 3" opacity=".45" />
    <path d="M24 18.5 29.5 24 24 29.5 18.5 24Z" fill="var(--identity)" />
    <path d="M24 18.5 29.5 24 24 24Z" fill="var(--identity-hover)" />
  </svg>`;
}

function bindingRow(label: string, value: string): string {
  const valueMarkup =
    label === 'Expires'
      ? `<time datetime="${escapeHtml(value)}">${escapeHtml(value)}</time>`
      : escapeHtml(value);
  return `<div><dt>${escapeHtml(label)}</dt><dd>${valueMarkup}</dd></div>`;
}

function trustFooter(): string {
  return `<footer class="trust" aria-label="Local signer trust boundaries">
    <div><span class="trust-icon" aria-hidden="true"></span><span><strong>Loopback only</strong><span>Bound to 127.0.0.1 on this machine</span></span></div>
    <div><span class="trust-icon" aria-hidden="true"></span><span><strong>Session isolated</strong><span>MoltNet session credentials never enter this app</span></span></div>
    <div><span class="trust-icon" aria-hidden="true"></span><span><strong>Hardware attested</strong><span>The security key signs the prepared digest</span></span></div>
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
