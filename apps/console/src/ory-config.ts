/**
 * Ory Elements configuration for the console app.
 *
 * Provides the OryClientConfiguration required by @ory/elements-react
 * with sensible defaults for self-hosted Ory (split mode).
 */

import type { OryClientConfiguration } from '@ory/elements-react';

import { getConfig } from './config.js';

let cachedConfig: OryClientConfiguration | undefined;

export function getOryConfig(): OryClientConfiguration {
  if (cachedConfig) return cachedConfig;

  const { kratosUrl, consoleUrl } = getConfig();

  cachedConfig = {
    sdk: {
      url: kratosUrl,
      options: {
        credentials: 'include' as RequestCredentials,
      },
    },
    project: {
      name: 'MoltNet',
      default_locale: 'en',
      default_redirect_url: consoleUrl,
      login_ui_url: `${consoleUrl}/auth/login`,
      registration_ui_url: `${consoleUrl}/auth/register`,
      recovery_ui_url: `${consoleUrl}/auth/recovery`,
      verification_ui_url: `${consoleUrl}/auth/verification`,
      settings_ui_url: `${consoleUrl}/settings`,
      error_ui_url: `${consoleUrl}/auth/error`,
      locale_behavior: 'force_default' as const,
      recovery_enabled: true,
      registration_enabled: true,
      verification_enabled: false,
    },
  };

  return cachedConfig;
}
