/**
 * RegisterPage — Ory Elements registration flow.
 *
 * Browser flow pattern for a Vite SPA:
 * - If ?flow= is present: fetch the flow as JSON.
 * - If not: redirect the browser to Kratos's browser registration endpoint.
 *   Never call createBrowserRegistrationFlow() via fetch — causes Origin:null CORS failure.
 */

import '@ory/elements-react/theme/styles.css';

import { Registration } from '@ory/elements-react/theme';
import { type ComponentProps, useEffect, useState } from 'react';

import { getConfig } from '../../config.js';
import { getKratosClient } from '../../kratos.js';
import { getOryConfig } from '../../ory-config.js';

export function RegisterPage() {
  const [flow, setFlow] =
    useState<ComponentProps<typeof Registration>['flow']>();

  useEffect(() => {
    const flowId = new URLSearchParams(window.location.search).get('flow');

    if (!flowId) {
      window.location.assign(
        `${getConfig().kratosUrl}/self-service/registration/browser`,
      );
      return;
    }

    getKratosClient()
      .getRegistrationFlow({ id: flowId })
      .then((nextFlow) => {
        setFlow(nextFlow as ComponentProps<typeof Registration>['flow']);
      })
      .catch(() => {
        window.location.assign(
          `${getConfig().kratosUrl}/self-service/registration/browser`,
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
      <Registration flow={flow} config={getOryConfig()} />
    </div>
  );
}
