import {
  type LoginFlow,
  type RecoveryFlow,
  type RegistrationFlow,
  ResponseError,
  type SettingsFlow,
  type VerificationFlow,
} from '@ory/client-fetch';

import { getConfig } from '../config.js';
import { getKratosClient } from '../kratos.js';
import type { AuthFlow } from './ory-config.js';

export type LoadedFlow =
  | { kind: 'login'; flow: LoginFlow }
  | { kind: 'registration'; flow: RegistrationFlow }
  | { kind: 'recovery'; flow: RecoveryFlow }
  | { kind: 'verification'; flow: VerificationFlow }
  | { kind: 'settings'; flow: SettingsFlow };

/** JSON flow creation forwards only these documented browser-flow parameters.
 * Browser-endpoint handoffs forward the query minus `flow` instead, and Kratos
 * validates it. return_to is passed to Kratos for validation; never navigate
 * to it ourselves.
 */
function flowParameters(search: URLSearchParams) {
  return {
    returnTo: search.get('return_to') ?? undefined,
    loginChallenge: search.get('login_challenge') ?? undefined,
    aal: search.get('aal') ?? undefined,
    refresh: search.get('refresh') === 'true',
    organization: search.get('organization') ?? undefined,
    via: search.get('via') ?? undefined,
  };
}

export async function loadFlow(
  kind: AuthFlow,
  search: URLSearchParams,
  signal: AbortSignal,
): Promise<LoadedFlow> {
  const sdk = getKratosClient();
  const id = search.get('flow');
  const params = flowParameters(search);
  const options = { signal, headers: { Accept: 'application/json' } };
  switch (kind) {
    case 'login':
      return {
        kind,
        flow: await (id
          ? sdk.getLoginFlow({ id }, options)
          : sdk.createBrowserLoginFlow(params, options)),
      };
    case 'registration':
      return {
        kind,
        flow: await (id
          ? sdk.getRegistrationFlow({ id }, options)
          : sdk.createBrowserRegistrationFlow(params, options)),
      };
    case 'recovery':
      return {
        kind,
        flow: await (id
          ? sdk.getRecoveryFlow({ id }, options)
          : sdk.createBrowserRecoveryFlow(params, options)),
      };
    case 'verification':
      return {
        kind,
        flow: await (id
          ? sdk.getVerificationFlow({ id }, options)
          : sdk.createBrowserVerificationFlow(params, options)),
      };
    case 'settings':
      return {
        kind,
        flow: await (id
          ? sdk.getSettingsFlow({ id }, options)
          : sdk.createBrowserSettingsFlow(params, options)),
      };
  }
}

interface FlowFailure {
  redirect_browser_to?: string;
  use_flow_id?: string;
  error?: { id?: string };
}

export async function flowFailure(error: unknown) {
  if (!(error instanceof ResponseError)) return null;
  let body: FlowFailure = {};
  try {
    body = (await error.response.clone().json()) as FlowFailure;
  } catch {
    // Non-JSON errors remain retryable on the current screen.
  }
  return { status: error.response.status, body };
}

/** Kratos answers JSON flow creation with 400 `session_already_available`
 * when a session exists. Its browser endpoint instead validates return_to and
 * redirects itself, so hand the public initialization context over to it.
 */
export function browserFlowUrl(
  kind: AuthFlow,
  search: URLSearchParams,
): string {
  const url = new URL(`/self-service/${kind}/browser`, getConfig().kratosUrl);
  url.search = withoutFlow(search).toString();
  return url.toString();
}

export function withoutFlow(search: URLSearchParams): URLSearchParams {
  const parameters = new URLSearchParams(search);
  parameters.delete('flow');
  return parameters;
}

export function navigateToOryRedirect(destination: string): void {
  const url = new URL(destination, window.location.href);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Authentication returned an invalid redirect');
  }
  window.location.assign(url.toString());
}

const RESTART_KEY = 'moltnet-auth-flow-restart';
const RESTART_TTL_MS = 60_000;

/** Elements restarts at Ory's browser endpoint after CSRF/missing-flow errors.
 * Carry the public initialization context across that navigation, once per tab.
 * Never store form values, session cookies or credentials here.
 */
export function rememberFlowRestart(kind: AuthFlow): void {
  try {
    sessionStorage.setItem(
      RESTART_KEY,
      JSON.stringify({
        kind,
        search: window.location.search,
        at: Date.now(),
      }),
    );
  } catch {
    // Storage may be disabled. The backend can still restart the form.
  }
}

export function flowSearch(kind: AuthFlow): URLSearchParams {
  const search = new URLSearchParams(window.location.search);
  try {
    const value = sessionStorage.getItem(RESTART_KEY);
    if (!value) return search;
    const pending = JSON.parse(value) as {
      kind?: unknown;
      search?: unknown;
      at?: unknown;
    };
    if (
      pending.kind !== kind ||
      typeof pending.search !== 'string' ||
      typeof pending.at !== 'number' ||
      Date.now() - pending.at > RESTART_TTL_MS
    )
      return search;
    return withoutFlow(new URLSearchParams(pending.search));
  } catch {
    return search;
  }
}

export function clearFlowRestart(): void {
  try {
    sessionStorage.removeItem(RESTART_KEY);
  } catch {
    /* Storage may be disabled. */
  }
}

/** Complete the OAuth session only after explicit confirmation, then end the
 * Kratos browser session before following Hydra's validated continuation.
 */
export async function logoutOAuthSession(
  logoutChallenge: string,
): Promise<void> {
  const response = await fetch(
    new URL('/oauth2/logout', getConfig().apiBaseUrl),
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logoutChallenge }),
    },
  );
  if (!response.ok) throw new Error('OAuth sign-out could not complete');
  const { redirectTo } = (await response.json()) as { redirectTo: string };
  if (typeof redirectTo !== 'string')
    throw new Error('Invalid logout continuation');
  try {
    const flow = await getKratosClient().createBrowserLogoutFlow({
      returnTo: redirectTo,
    });
    navigateToOryRedirect(flow.logout_url);
  } catch (error) {
    const failure = await flowFailure(error);
    if (failure?.status === 401) navigateToOryRedirect(redirectTo);
    else throw error;
  }
}
