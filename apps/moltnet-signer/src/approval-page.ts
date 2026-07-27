import type { SignerApprovalDisplay } from './ceremony-service.js';

export function renderApprovalPage(input: {
  ceremonyId: string;
  confirmationToken: string;
  display: SignerApprovalDisplay;
}): string {
  const rows = [
    ['Operation', input.display.operation],
    ['Team', input.display.teamId],
    ['Requester', input.display.claimantId],
    ['Resource', input.display.resourceId],
    ['Verification method', input.display.verificationMethod],
    ['Audience', input.display.audience],
    ['Expires', input.display.expiresAt],
    ['Signing payload', input.display.signingPayload],
  ].filter((row): row is [string, string] => row[1] !== undefined);
  return page(
    'Review exact action',
    `<main>
      <p class="eyebrow">MoltNet local signer</p>
      <h1>Review exact action</h1>
      <p class="lede">The security key will sign only the server-owned digest for this action.</p>
      <section aria-labelledby="action-title">
        <h2 id="action-title">Exact action</h2>
        <p class="action" data-signing-action>${escapeHtml(input.display.action)}</p>
      </section>
      <dl>${rows
        .map(
          ([label, value]) =>
            `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`,
        )
        .join('')}</dl>
      <form method="post" action="/ceremonies/${encodeURIComponent(input.ceremonyId)}/confirm">
        <input type="hidden" name="confirmationToken" value="${escapeHtml(input.confirmationToken)}">
        <button type="submit">Sign exact action</button>
      </form>
      <p class="note">Closing this window leaves the request unsigned.</p>
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
      <p class="eyebrow">MoltNet local signer</p>
      <h1>${escapeHtml(input.title)}</h1>
      <p class="${input.success ? 'success' : 'error'}">${escapeHtml(input.message)}</p>
      <p class="note">You can close this window and return to the Console.</p>
    </main>`,
  );
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} · MoltNet signer</title>
  <style>
    :root{color-scheme:dark;font-family:ui-sans-serif,system-ui,sans-serif;background:#090b10;color:#f4f5f7}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at top,#172035 0,#090b10 52%)}
    main{width:min(680px,100%);border:1px solid #30384a;background:#10141e;border-radius:18px;padding:clamp(24px,5vw,48px);box-shadow:0 24px 80px #0008}
    h1{font-size:clamp(2rem,6vw,3.6rem);line-height:1;margin:.2em 0}.eyebrow{color:#8ba8ff;text-transform:uppercase;letter-spacing:.12em;font-size:.75rem;font-weight:700}
    .lede,.note{color:#aeb6c8;line-height:1.6}.action{font-size:1.45rem;line-height:1.35;font-weight:700;border:1px solid #526a9f;border-radius:10px;padding:14px 18px;background:#171d2b}
    dl{border-top:1px solid #30384a;margin:28px 0}dl div{display:grid;grid-template-columns:minmax(110px,.4fr) 1fr;gap:18px;padding:12px 0;border-bottom:1px solid #252c3a}dt{color:#8e99ad}dd{margin:0;overflow-wrap:anywhere}
    button{width:100%;border:0;border-radius:10px;background:#dce6ff;color:#10182a;padding:15px 20px;font:inherit;font-weight:800;cursor:pointer}button:hover{background:#fff}button:focus-visible{outline:3px solid #8ba8ff;outline-offset:3px}
    .success{color:#8de0b5}.error{color:#ff9a9a}@media(max-width:520px){dl div{grid-template-columns:1fr;gap:4px}}
  </style>
</head>
<body>${body}</body>
</html>`;
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
