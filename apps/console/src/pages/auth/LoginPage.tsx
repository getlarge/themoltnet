/**
 * LoginPage — Ory Elements login flow.
 *
 * Browser flow pattern for a Vite SPA:
 * - If ?flow= is present: fetch the flow as JSON (same-origin, no redirect, no CORS issue).
 * - If not: redirect the browser (window.location) to Kratos's browser flow endpoint.
 *   Kratos then redirects the browser back to this page with ?flow=<id>.
 *   Never call createBrowserLoginFlow() via fetch — Kratos responds with a 302
 *   which strips Origin to null and breaks CORS.
 */

import '@ory/elements-react/theme/styles.css';

import { Login } from '@ory/elements-react/theme';
import { type ComponentProps, useEffect, useState } from 'react';

import { getConfig } from '../../config.js';
import { getKratosClient } from '../../kratos.js';
import { getOryConfig } from '../../ory-config.js';

export function LoginPage() {
  const [flow, setFlow] = useState<ComponentProps<typeof Login>['flow']>();

  useEffect(() => {
    const flowId = new URLSearchParams(window.location.search).get('flow');

    if (!flowId) {
      // Let the browser follow the redirect — preserves Origin header
      window.location.assign(
        `${getConfig().kratosUrl}/self-service/login/browser`,
      );
      return;
    }

    getKratosClient()
      .getLoginFlow({ id: flowId })
      .then((nextFlow) => {
        setFlow(nextFlow as ComponentProps<typeof Login>['flow']);
      })
      .catch(() => {
        // Flow expired or invalid — restart
        window.location.assign(
          `${getConfig().kratosUrl}/self-service/login/browser`,
        );
      });
  }, []);

  if (!flow) {
    return null;
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}
    >
      <Login flow={flow} config={getOryConfig()} />
    </div>
  );
}
