import type { OryClientConfiguration } from '@ory/elements-react';

import { getConfig } from '../config.js';
import routes from './routes.json';

export const authRoutes = routes;
export type AuthPage = keyof typeof authRoutes;
export type AuthFlow = Exclude<AuthPage, 'error' | 'logout'>;

export function authUrl(page: AuthPage): string {
  return new URL(authRoutes[page], getConfig().consoleUrl).toString();
}

export function getOryConfig(): OryClientConfiguration {
  const { kratosUrl, consoleUrl } = getConfig();
  return {
    sdk: { url: kratosUrl, options: { credentials: 'include' } },
    project: {
      name: 'MoltNet',
      default_redirect_url: new URL('/', consoleUrl).toString(),
      login_ui_url: authUrl('login'),
      registration_ui_url: authUrl('registration'),
      recovery_ui_url: authUrl('recovery'),
      verification_ui_url: authUrl('verification'),
      settings_ui_url: authUrl('settings'),
      error_ui_url: authUrl('error'),
      // These links expose the standard MoltNet self-service policy. Methods,
      // including social login and MFA, always come from Kratos flow nodes.
      registration_enabled: true,
      recovery_enabled: true,
      verification_enabled: true,
    },
  };
}
