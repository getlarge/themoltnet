import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { parse } from 'yaml';

const read = (file) =>
  readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const routes = JSON.parse(read('apps/console/src/auth/routes.json'));
const project = JSON.parse(read('infra/ory/project.json'));
const network = project.services.identity.config.selfservice;
const local = parse(read('infra/ory/kratos/kratos.yaml')).selfservice;
const selfhost = parse(read('deploy/ory/compose.yaml')).services.kratos
  .environment;

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
  const hydra = parse(read('deploy/ory/compose.yaml')).services.hydra
    .environment;
  const development = parse(read('infra/ory/hydra/hydra.yaml'));
  const cloud = project.services.oauth2.config.urls;
  assert.equal(hydra.URLS_LOGIN, 'https://${CONSOLE_DOMAIN}' + routes.login);
  assert.equal(development.urls.login, 'http://localhost:5174' + routes.login);
  assert.equal(cloud.login, '${CONSOLE_BASE_URL}' + routes.login);
  assert.equal(cloud.error, '${CONSOLE_BASE_URL}' + routes.error);
  assert.equal(cloud.registration, '${CONSOLE_BASE_URL}' + routes.registration);
  assert.equal(hydra.URLS_CONSENT, 'https://${API_DOMAIN}/oauth2/consent');
  assert.equal(
    development.urls.consent,
    'http://localhost:8080/oauth2/consent',
  );
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
  assert.equal(
    project.services.oauth2.config.urls.consent,
    '${API_BASE_URL}/oauth2/consent',
  );
});
