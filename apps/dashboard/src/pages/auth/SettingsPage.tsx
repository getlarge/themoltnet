/**
 * SettingsPage — Kratos browser settings flow.
 *
 * Allows authenticated users to update their profile and password.
 */

import type { SettingsFlow, UiNodeInputAttributes } from '@ory/client-fetch';
import { Button, Card, Input, Stack, Text } from '@themoltnet/design-system';
import { useCallback, useEffect, useState } from 'react';

import { getKratosClient } from '../../kratos.js';

export function SettingsPage() {
  const [flow, setFlow] = useState<SettingsFlow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const kratosClient = getKratosClient();
    kratosClient
      .createBrowserSettingsFlow()
      .then(setFlow)
      .catch(() => setError('Failed to initialize settings flow'));
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!flow) return;

      setIsSubmitting(true);
      setError(null);
      setSuccess(false);

      const formData = new FormData(e.currentTarget);
      const password = formData.get('password') as string;

      try {
        const kratosClient = getKratosClient();
        const result = await kratosClient.updateSettingsFlow({
          flow: flow.id,
          updateSettingsFlowBody: {
            method: 'password',
            password,
          },
        });
        setFlow(result);
        setSuccess(true);
      } catch {
        setError('Failed to update settings.');
        try {
          const kratosClient = getKratosClient();
          const newFlow = await kratosClient.createBrowserSettingsFlow();
          setFlow(newFlow);
        } catch {
          // ignore
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [flow],
  );

  return (
    <Stack gap={6}>
      <Text variant="h2">Settings</Text>

      <Card style={{ maxWidth: 500, padding: '1.5rem' }}>
        <Stack gap={4}>
          <Text variant="h3">Change Password</Text>

          {error && <Text color="error">{error}</Text>}
          {success && (
            <Text color="success">Settings updated successfully.</Text>
          )}

          {flow && (
            <form onSubmit={handleSubmit}>
              <Stack gap={4}>
                {flow.ui.nodes
                  .filter(
                    (node) =>
                      node.type === 'input' &&
                      (node.attributes as UiNodeInputAttributes).name ===
                        'password',
                  )
                  .map((node) => {
                    const attrs = node.attributes as UiNodeInputAttributes;
                    return (
                      <Input
                        key={attrs.name}
                        name={attrs.name}
                        type="password"
                        placeholder={node.meta?.label?.text ?? 'New password'}
                        required={attrs.required}
                      />
                    );
                  })}
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : 'Update Password'}
                </Button>
              </Stack>
            </form>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
