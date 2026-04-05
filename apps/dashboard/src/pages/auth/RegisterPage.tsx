/**
 * RegisterPage — Kratos browser registration flow.
 *
 * Creates a browser registration flow and renders the form fields.
 * On success, redirects to login.
 */

import type {
  RegistrationFlow,
  UiNodeInputAttributes,
} from '@ory/client-fetch';
import { Button, Card, Input, Stack, Text } from '@themoltnet/design-system';
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'wouter';

import { useAuth } from '../../auth/useAuth.js';
import { getKratosClient } from '../../kratos.js';

export function RegisterPage() {
  const [flow, setFlow] = useState<RegistrationFlow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
      .catch(() => setError('Failed to initialize registration flow'));
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!flow) return;

      setIsSubmitting(true);
      setError(null);

      const formData = new FormData(e.currentTarget);

      try {
        const kratosClient = getKratosClient();
        await kratosClient.updateRegistrationFlow({
          flow: flow.id,
          updateRegistrationFlowBody: {
            method: 'password',
            traits: {
              email: formData.get('traits.email') as string,
              username: formData.get('traits.username') as string,
            },
            password: formData.get('password') as string,
          },
        });
        navigate('/auth/login');
      } catch {
        setError('Registration failed. Please try again.');
        try {
          const kratosClient = getKratosClient();
          const newFlow = await kratosClient.createBrowserRegistrationFlow();
          setFlow(newFlow);
        } catch {
          // ignore
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [flow, navigate],
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
            Create Account
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
                  {isSubmitting ? 'Creating account...' : 'Register'}
                </Button>
              </Stack>
            </form>
          )}

          <Text color="muted" style={{ textAlign: 'center' }}>
            Already have an account?{' '}
            <a
              href="/auth/login"
              onClick={(e) => {
                e.preventDefault();
                navigate('/auth/login');
              }}
              style={{ color: 'inherit', textDecoration: 'underline' }}
            >
              Sign in
            </a>
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
}
