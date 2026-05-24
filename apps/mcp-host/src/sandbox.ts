import { buildAllowAttribute } from '@modelcontextprotocol/ext-apps/app-bridge';

const ALLOWED_REFERRER_PATTERN =
  /^http:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/;
const SANDBOX_PROXY_READY = 'ui/notifications/sandbox-proxy-ready';
const SANDBOX_RESOURCE_READY = 'ui/notifications/sandbox-resource-ready';

function hasMethod(
  value: unknown,
  method: string,
): value is {
  method: string;
  params?: { html?: string; permissions?: unknown };
} {
  return (
    !!value &&
    typeof value === 'object' &&
    'method' in value &&
    (value as { method?: unknown }).method === method
  );
}

if (window.self === window.top) {
  throw new Error('sandbox.html must run inside an iframe');
}

if (!document.referrer || !ALLOWED_REFERRER_PATTERN.test(document.referrer)) {
  throw new Error(`Embedding domain not allowed: ${document.referrer}`);
}

const expectedHostOrigin = new URL(document.referrer).origin;
const appFrame = document.createElement('iframe');
appFrame.setAttribute('sandbox', 'allow-scripts allow-forms');
appFrame.style.border = '0';
appFrame.style.display = 'block';
appFrame.style.height = '100%';
appFrame.style.width = '100%';
// The proxy is a transparent pass-through: html/body must fill the outer
// #app-frame so the nested appFrame's `height: 100%` resolves against a real
// height instead of collapsing to its content's initial paint (a sliver).
// The outer frame's height is driven by ext-apps autoResize measuring the app.
document.documentElement.style.height = '100%';
document.body.style.height = '100%';
document.body.style.margin = '0';
document.body.append(appFrame);

window.parent.postMessage(
  {
    jsonrpc: '2.0',
    method: SANDBOX_PROXY_READY,
    params: {},
  },
  expectedHostOrigin,
);

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source === window.parent) {
    if (event.origin !== expectedHostOrigin) {
      return;
    }

    if (hasMethod(event.data, SANDBOX_RESOURCE_READY)) {
      const params = event.data.params;

      const allow = buildAllowAttribute(params?.permissions as never);
      if (allow) {
        appFrame.setAttribute('allow', allow);
      }
      appFrame.srcdoc = typeof params?.html === 'string' ? params.html : '';
      return;
    }

    appFrame.contentWindow?.postMessage(event.data, '*');
    return;
  }

  if (event.source === appFrame.contentWindow) {
    window.parent.postMessage(event.data, expectedHostOrigin);
  }
});
