/**
 * ErrorPage — Displays Kratos flow errors.
 *
 * Shown when Kratos redirects to the error UI URL.
 */

import type { FlowError } from '@ory/client-fetch';
import { Card, Stack, Text } from '@themoltnet/design-system';
import { useEffect, useState } from 'react';

import { getKratosClient } from '../../kratos.js';

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

  return (
    <Stack
      align="center"
      justify="center"
      style={{ minHeight: '100vh', padding: '2rem' }}
    >
      <Card style={{ maxWidth: 500, width: '100%', padding: '2rem' }}>
        <Stack gap={4}>
          <Text variant="h2" style={{ textAlign: 'center' }}>
            An error occurred
          </Text>

          {flowError?.error && (
            <Text color="error">
              {typeof flowError.error === 'object' &&
              'message' in (flowError.error as Record<string, unknown>)
                ? (
                    flowError.error as {
                      message: string;
                    }
                  ).message
                : 'An unexpected error occurred.'}
            </Text>
          )}

          {!flowError && (
            <Text color="muted" style={{ textAlign: 'center' }}>
              No error details available.
            </Text>
          )}

          <Text color="muted" style={{ textAlign: 'center' }}>
            <a
              href="/auth/login"
              style={{ color: 'inherit', textDecoration: 'underline' }}
            >
              Return to login
            </a>
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
}
