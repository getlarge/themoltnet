/**
 * LoginPage — Ory Elements login flow.
 *
 * Uses @ory/elements-react default theme for the login form.
 * Creates a browser login flow and renders via Ory Elements.
 */

import '@ory/elements-react/theme/styles.css';

import type { LoginFlow } from '@ory/client-fetch';
import { Login } from '@ory/elements-react/theme';
import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';

import { useAuth } from '../../auth/useAuth.js';
import { getKratosClient } from '../../kratos.js';
import { getOryConfig } from '../../ory-config.js';

export function LoginPage() {
  const [flow, setFlow] = useState<LoginFlow | null>(null);
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    const kratosClient = getKratosClient();
    kratosClient
      .createBrowserLoginFlow()
      .then(setFlow)
      .catch(() => {
        // Failed to create login flow
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
