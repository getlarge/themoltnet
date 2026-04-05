/**
 * RegisterPage — Ory Elements registration flow.
 *
 * Uses @ory/elements-react default theme for the registration form.
 */

import '@ory/elements-react/theme/styles.css';

import type { RegistrationFlow } from '@ory/client-fetch';
import { Registration } from '@ory/elements-react/theme';
import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';

import { useAuth } from '../../auth/useAuth.js';
import { getKratosClient } from '../../kratos.js';
import { getOryConfig } from '../../ory-config.js';

export function RegisterPage() {
  const [flow, setFlow] = useState<RegistrationFlow | null>(null);
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
      .createBrowserRegistrationFlow()
      .then(setFlow)
      .catch(() => {
        // Failed to create registration flow
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
