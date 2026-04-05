/**
 * ErrorPage — Ory Elements error display.
 *
 * Uses @ory/elements-react default theme for the error page.
 */

import '@ory/elements-react/theme/styles.css';

import type { FlowError } from '@ory/client-fetch';
import { Error as OryError } from '@ory/elements-react/theme';
import { useEffect, useState } from 'react';

import { getKratosClient } from '../../kratos.js';
import { getOryConfig } from '../../ory-config.js';

export function ErrorPage() {
  const [flowError, setFlowError] = useState<FlowError | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorId = params.get('id');
    if (!errorId) return;

    const kratosClient = getKratosClient();
    kratosClient
      .getFlowError({ id: errorId })
      .then(setFlowError)
      .catch(() => {
        // Could not fetch error details
      });
  }, []);

  if (!flowError) {
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
      <OryError error={flowError} config={getOryConfig()} />
    </div>
  );
}
