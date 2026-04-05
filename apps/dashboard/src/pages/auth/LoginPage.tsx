/**
 * LoginPage — Kratos browser login flow.
 *
 * Creates a browser login flow and renders the form fields from Kratos UI nodes.
 * On success, refreshes the auth session and redirects to the dashboard.
 */

import type { LoginFlow, UiNodeInputAttributes } from '@ory/client-fetch';
import { Button, Card, Input, Stack, Text } from '@themoltnet/design-system';
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'wouter';

import { useAuth } from '../../auth/useAuth.js';
import { getKratosClient } from '../../kratos.js';

export function LoginPage() {
  const [flow, setFlow] = useState<LoginFlow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isAuthenticated, refreshSession } = useAuth();
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
      .catch(() => setError('Failed to initialize login flow'));
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!flow) return;

      setIsSubmitting(true);
      setError(null);

      const formData = new FormData(e.currentTarget);
      const identifier = formData.get('identifier') as string;
      const password = formData.get('password') as string;

      try {
        const kratosClient = getKratosClient();
        await kratosClient.updateLoginFlow({
          flow: flow.id,
          updateLoginFlowBody: {
            method: 'password',
            identifier,
            password,
          },
        });
        await refreshSession();
        navigate('/');
      } catch {
        setError('Invalid credentials. Please try again.');
        try {
          const kratosClient = getKratosClient();
          const newFlow = await kratosClient.createBrowserLoginFlow();
          setFlow(newFlow);
        } catch {
          // ignore
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [flow, navigate, refreshSession],
  );

  return (
    <Stack
      align="center"
      justify="center"
      style={{ minHeight: '100vh', padding: '2rem' }}
    >
      <Card style={{ maxWidth: 400, width: '100%', padding: '2rem' }}>
        <Stack gap={6}>
          <Text variant="h2" style={{ textAlign: 'center' }}>
            Sign in to MoltNet
          </Text>

          {error && (
            <Text color="error" style={{ textAlign: 'center' }}>
              {error}
            </Text>
          )}

          {flow && (
            <form onSubmit={handleSubmit}>
              <Stack gap={4}>
                {flow.ui.nodes
                  .filter(
                    (node) =>
                      node.type === 'input' &&
                      (node.attributes as UiNodeInputAttributes).type !==
                        'hidden' &&
                      (node.attributes as UiNodeInputAttributes).type !==
                        'submit',
                  )
                  .map((node) => {
                    const attrs = node.attributes as UiNodeInputAttributes;
                    return (
                      <Input
                        key={attrs.name}
                        name={attrs.name}
                        type={attrs.type === 'password' ? 'password' : 'text'}
                        placeholder={node.meta?.label?.text ?? attrs.name}
                        required={attrs.required}
                        defaultValue={
                          typeof attrs.value === 'string'
                            ? attrs.value
                            : undefined
                        }
                      />
                    );
                  })}
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Signing in...' : 'Sign in'}
                </Button>
              </Stack>
            </form>
          )}

          <Text color="muted" style={{ textAlign: 'center' }}>
            Don&apos;t have an account?{' '}
            <a
              href="/auth/register"
              onClick={(e) => {
                e.preventDefault();
                navigate('/auth/register');
              }}
              style={{ color: 'inherit', textDecoration: 'underline' }}
            >
              Register
            </a>
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
}
