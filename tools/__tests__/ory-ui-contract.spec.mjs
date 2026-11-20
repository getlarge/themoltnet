import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { parse } from 'yaml';

const read = (file) =>
  readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const routes = JSON.parse(read('apps/console/src/auth/routes.json'));
const project = JSON.parse(read('infra/ory/project.json'));
const network = project.services.identity.config.selfservice;
const cloud = project.services.oauth2.config.urls;
const kratosLocal = parse(read('infra/ory/kratos/kratos.yaml'));
const local = kratosLocal.selfservice;
const hydraLocal = parse(read('infra/ory/hydra/hydra.yaml'));
const oryCompose = parse(read('deploy/ory/compose.yaml'));
const selfhost = oryCompose.services.kratos.environment;
const hydra = oryCompose.services.hydra.environment;
const selfhostCompose = parse(read('deploy/self-host/compose.yaml'));
const e2eCompose = parse(read('docker-compose.e2e.yaml'));
const baseCompose = parse(read('docker-compose.base.yaml'));
const consoleE2e = JSON.parse(read('apps/console-e2e/package.json'));
const authSpec = read('apps/console-e2e/src/auth-self-service.e2e.spec.ts');

test('every backend representation implements the Console auth route contract', () => {
  for (const [name, route] of Object.entries(routes)) {
    if (name === 'logout') continue;
    assert.equal(network.flows[name].ui_url, '${CONSOLE_BASE_URL}' + route);
    assert.equal(local.flows[name].ui_url, 'http://localhost:5174' + route);
    assert.equal(
      selfhost[`SELFSERVICE_FLOWS_${name.toUpperCase()}_UI_URL`],
      'https://${CONSOLE_DOMAIN}' + route,
    );
  }
});

test('OAuth starts at the Console and consent stays with the REST API', () => {
  assert.equal(hydra.URLS_LOGIN, 'https://${CONSOLE_DOMAIN}' + routes.login);
  assert.equal(hydraLocal.urls.login, 'http://localhost:5174' + routes.login);
  assert.equal(cloud.login, '${CONSOLE_BASE_URL}' + routes.login);
  const e2e = e2eCompose.services.hydra.environment;
  assert.equal(e2e.URLS_CONSENT, 'http://localhost:8080/oauth2/consent');
  assert.ok(
    e2eCompose.services['rest-api'].environment.CORS_ORIGINS.split(
      ',',
    ).includes('http://localhost:8080'),
  );
  assert.ok(
    selfhostCompose.services['rest-api'].environment.CORS_ORIGINS.split(
      ',',
    ).includes('https://${API_DOMAIN}'),
  );
  assert.equal(hydra.URLS_LOGOUT, 'https://${CONSOLE_DOMAIN}' + routes.logout);
  assert.equal(hydraLocal.urls.logout, 'http://localhost:5174' + routes.logout);
  assert.equal(cloud.logout, '${CONSOLE_BASE_URL}' + routes.logout);
  assert.equal(cloud.error, '${CONSOLE_BASE_URL}' + routes.error);
  assert.equal(cloud.registration, '${CONSOLE_BASE_URL}' + routes.registration);
  assert.equal(hydra.URLS_CONSENT, 'https://${API_DOMAIN}/oauth2/consent');
  assert.equal(hydraLocal.urls.consent, 'http://localhost:8000/oauth2/consent');
});

test('Network allows the Hydra continuation used after Kratos logout', () => {
  assert.ok(
    network.allowed_return_urls.includes(
      '${ORY_PROJECT_URL}/oauth2/sessions/logout',
    ),
  );
});

test('self-hosted browser approval shares a secure session across identity and API hosts', () => {
  assert.match(selfhost.SESSION_COOKIE_DOMAIN, /^\$\{KRATOS_COOKIE_DOMAIN:\?/);
  assert.equal(selfhost.SESSION_COOKIE_SECURE, 'true');
  assert.equal(
    selfhostCompose.services.kratos.extends.file,
    '../ory/compose.yaml',
  );
  const example = Object.fromEntries(
    read('deploy/self-host/.env.example')
      .split('\n')
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => line.split('=')),
  );
  for (const host of [example.IDENTITY_DOMAIN, example.API_DOMAIN]) {
    assert.ok(host.endsWith(`.${example.KRATOS_COOKIE_DOMAIN}`));
  }
  // The public deployment setting must not broaden localhost cookie scope.
  assert.equal(kratosLocal.session.cookie.domain, undefined);
});

test('Console E2E default inputs hash every authentication scenario flag', () => {
  const inputs = consoleE2e.nx.namedInputs.default;
  const flags = new Set(
    [...authSpec.matchAll(/process\.env\['(AUTH_UI_[A-Z_]+)'\]/g)].map(
      ([, flag]) => flag,
    ),
  );
  assert.ok(flags.size >= 4);
  for (const flag of flags) {
    assert.ok(
      inputs.some((input) => input.env === flag),
      `${flag} is hashed`,
    );
  }
});

test('registration still requires explicit login for human onboarding', () => {
  for (const method of ['password', 'oidc']) {
    for (const config of [network, local]) {
      assert.ok(
        !config.flows.registration.after[method].hooks.some(
          ({ hook }) => hook === 'session',
        ),
      );
    }
    assert.equal(
      network.flows.registration.after[method].default_browser_return_url,
      '${CONSOLE_BASE_URL}' + routes.login,
    );
    assert.equal(
      local.flows.registration.after[method].default_browser_return_url,
      'http://localhost:5174' + routes.login,
    );
    assert.equal(
      selfhost[
        `SELFSERVICE_FLOWS_REGISTRATION_AFTER_${method.toUpperCase()}_DEFAULT_BROWSER_RETURN_URL`
      ],
      'https://${CONSOLE_DOMAIN}' + routes.login,
    );
  }
});

// Shared development and integration stacks must exercise the product UI.
test('Compose stacks use Mailpit and never package the retired reference UI', () => {
  for (const file of [
    'docker-compose.base.yaml',
    'docker-compose.yaml',
    'docker-compose.e2e.yaml',
    'deploy/ory/compose.yaml',
    'deploy/self-host/compose.yaml',
  ]) {
    assert.doesNotMatch(
      read(file),
      /kratos-selfservice-ui|kratos-ui|mailslurper/i,
    );
  }
  assert.match(
    baseCompose.services.mailpit.image,
    /^axllent\/mailpit:v[\d.]+@sha256:[a-f0-9]{64}$/,
  );
});
