#!/usr/bin/env node

// Creates a dedicated Renovate GitHub App through GitHub's manifest flow.
// The private key goes directly from the conversion response to the Actions
// Environment secret on stdin. Neither the key nor CLI errors are printed.
// Run `pnpm run renovate:create-app` with an admin `gh` login, review the
// manifest in GitHub, then install the app on this repository only.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

export const REPOSITORY = 'getlarge/themoltnet';
export const ENVIRONMENT = 'renovate';

export const PERMISSIONS = Object.freeze({
  administration: 'read',
  checks: 'write',
  contents: 'write',
  issues: 'write',
  metadata: 'read',
  pull_requests: 'write',
  statuses: 'write',
  vulnerability_alerts: 'read',
  workflows: 'write',
});

export function buildManifest({ name, redirectUrl }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9 -]{0,33}$/u.test(name)) {
    throw new Error('invalid app name');
  }
  return {
    name,
    url: `https://github.com/${REPOSITORY}`,
    redirect_url: redirectUrl,
    description: `Self-hosted Renovate for ${REPOSITORY}`,
    public: false,
    default_permissions: { ...PERMISSIONS },
    default_events: [],
    hook_attributes: { url: 'https://example.invalid/unused', active: false },
  };
}

export function renderForm({ manifest, state }) {
  const escaped = JSON.stringify(manifest)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;');
  return `<!doctype html><meta charset="utf-8"><title>Create Renovate App</title>
<body style="font-family:system-ui;max-width:40rem;margin:3rem auto">
<h1>Create the Renovate GitHub App</h1>
<p>GitHub will show the app name and permissions before creating it.</p>
<form action="https://github.com/settings/apps/new?state=${state}" method="post">
<input type="hidden" name="manifest" value="${escaped}">
<button type="submit">Continue to GitHub</button>
</form></body>`;
}

function gh(args, input) {
  const result = spawnSync('gh', args, {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  return {
    ok: !result.error && result.status === 0,
    output: result.stdout?.trim() ?? '',
  };
}

export function storeCredentials(
  app,
  runGh = gh,
  write = (line) => process.stdout.write(line),
) {
  const base = `repos/${REPOSITORY}/environments/${ENVIRONMENT}`;
  const restricted = runGh([
    'api',
    '-X',
    'PUT',
    base,
    '-F',
    'deployment_branch_policy[protected_branches]=false',
    '-F',
    'deployment_branch_policy[custom_branch_policies]=true',
  ]).ok;
  if (restricted) {
    runGh([
      'api',
      '-X',
      'POST',
      `${base}/deployment-branch-policies`,
      '-f',
      'name=main',
      '-f',
      'type=branch',
    ]);
  }
  // POST may fail if main is already present. Verify the final policy either way.
  const policies =
    restricted &&
    runGh([
      'api',
      `${base}/deployment-branch-policies`,
      '--jq',
      '[.branch_policies[] | {name, type}] == [{name: "main", type: "branch"}]',
    ]);
  const policy = Boolean(policies?.ok && policies.output === 'true');
  write(`${policy ? 'configured' : 'FAILED'}: main-only Environment\n`);
  if (!policy) return false;

  const repo = ['--repo', REPOSITORY, '--env', ENVIRONMENT];
  // The job-level issue guard needs a repository variable before a runner
  // starts; Environment variables are only available inside the job.
  const botVariable = runGh([
    'variable',
    'set',
    'RENOVATE_APP_BOT_LOGIN',
    '--repo',
    REPOSITORY,
    '--body',
    `${app.slug}[bot]`,
  ]).ok;
  write(`${botVariable ? 'stored' : 'FAILED'}: bot login variable\n`);
  if (!botVariable) return false;

  const variable = runGh([
    'variable',
    'set',
    'RENOVATE_APP_CLIENT_ID',
    ...repo,
    '--body',
    app.client_id,
  ]).ok;
  write(`${variable ? 'stored' : 'FAILED'}: client ID variable\n`);
  if (!variable) return false;

  const secret = runGh(
    ['secret', 'set', 'RENOVATE_APP_PRIVATE_KEY', ...repo],
    app.pem,
  ).ok;
  write(`${secret ? 'stored' : 'FAILED'}: private key secret\n`);
  return secret;
}

async function convert(code) {
  if (!/^[A-Za-z0-9_-]{8,128}$/u.test(code)) throw new Error('invalid code');
  const response = await globalThis.fetch(
    `https://api.github.com/app-manifests/${code}/conversions`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: globalThis.AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) throw new Error('conversion failed');
  const app = await response.json();
  if (
    typeof app?.slug !== 'string' ||
    !/^[a-z0-9-]+$/u.test(app.slug) ||
    typeof app?.client_id !== 'string' ||
    typeof app?.pem !== 'string' ||
    !app.pem.includes('PRIVATE KEY')
  ) {
    throw new Error('unexpected conversion response');
  }
  return { slug: app.slug, client_id: app.client_id, pem: app.pem };
}

export function createRequestHandler({
  name,
  state,
  getPort,
  close,
  convertApp = convert,
  storeApp = storeCredentials,
  write = (line) => process.stdout.write(line),
  setExitCode = (code) => {
    process.exitCode = code;
  },
}) {
  let done = false;

  const handler = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/' && !done) {
      const port = getPort();
      if (!port) {
        res.writeHead(503).end();
        return;
      }
      const manifest = buildManifest({
        name,
        redirectUrl: `http://127.0.0.1:${port}/callback`,
      });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderForm({ manifest, state }));
      return;
    }
    if (url.pathname !== '/callback' || done) {
      res.writeHead(404).end();
      return;
    }
    done = true;
    if (url.searchParams.get('state') !== state) {
      res.writeHead(400).end('State mismatch; nothing was stored.');
      write('FAILED: state mismatch; nothing stored\n');
      close();
      setExitCode(1);
      return;
    }
    try {
      const app = await convertApp(url.searchParams.get('code') ?? '');
      write(`created app: ${app.slug}\n`);
      const stored = storeApp(app);
      const install = `https://github.com/apps/${app.slug}/installations/new`;
      write(`install on ${REPOSITORY} only: ${install}\n`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<p>App created${stored ? ' and credentials stored' : '; storing credentials FAILED, see terminal'}.</p>` +
          `<p><a href="${install}">Install it on ${REPOSITORY} only</a>.</p>`,
      );
      setExitCode(stored ? 0 : 1);
    } catch {
      write('FAILED: app conversion (details suppressed)\n');
      res.writeHead(500).end('Conversion failed; see terminal.');
      setExitCode(1);
    }
    close();
  };

  return { handler, isDone: () => done };
}

function main() {
  const name = process.argv[2] ?? 'themoltnet-renovate';
  const state = randomBytes(16).toString('hex');
  let server;
  const { handler, isDone } = createRequestHandler({
    name,
    state,
    getPort: () => server.address()?.port,
    close: () => server.close(),
  });
  server = createServer(handler);

  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    process.stdout.write(`open http://127.0.0.1:${port}/ to create the app\n`);
  });
  globalThis
    .setTimeout(() => {
      if (!isDone()) {
        process.stdout.write('FAILED: timed out waiting for GitHub\n');
        process.exitCode = 1;
        server.close();
      }
    }, 600_000)
    .unref();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
