/**
 * SettingsPage — Ory Elements settings flow.
 *
 * Browser flow pattern for a Vite SPA:
 * - If ?flow= is present: fetch the flow as JSON.
 * - If not: redirect the browser to Kratos's browser settings endpoint.
 *   Never call createBrowserSettingsFlow() via fetch — causes Origin:null CORS failure.
 */

import '@ory/elements-react/theme/styles.css';

import type { SettingsFlow } from '@ory/client-fetch';
import { Settings } from '@ory/elements-react/theme';
import { useEffect, useState } from 'react';

import { getConfig } from '../../config.js';
import { getKratosClient } from '../../kratos.js';
import { getOryConfig } from '../../ory-config.js';

export function SettingsPage() {
  const [flow, setFlow] = useState<SettingsFlow | null>(null);

  useEffect(() => {
    const flowId = new URLSearchParams(window.location.search).get('flow');

    if (!flowId) {
      window.location.assign(
        `${getConfig().kratosUrl}/self-service/settings/browser`,
      );
      return;
    }

    getKratosClient()
      .getSettingsFlow({ id: flowId })
      .then(setFlow)
      .catch(() => {
        window.location.assign(
          `${getConfig().kratosUrl}/self-service/settings/browser`,
        );
      });
  }, []);

  if (!flow) {
    return null;
  }

  return <Settings flow={flow} config={getOryConfig()} />;
}
