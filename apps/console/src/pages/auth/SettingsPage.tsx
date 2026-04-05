/**
 * SettingsPage — Ory Elements settings flow.
 *
 * Uses @ory/elements-react default theme for the settings form.
 */

import '@ory/elements-react/theme/styles.css';

import type { SettingsFlow } from '@ory/client-fetch';
import { Settings } from '@ory/elements-react/theme';
import { useEffect, useState } from 'react';

import { getKratosClient } from '../../kratos.js';
import { getOryConfig } from '../../ory-config.js';

export function SettingsPage() {
  const [flow, setFlow] = useState<SettingsFlow | null>(null);

  useEffect(() => {
    const kratosClient = getKratosClient();
    kratosClient
      .createBrowserSettingsFlow()
      .then(setFlow)
      .catch(() => {
        // Failed to create settings flow
      });
  }, []);

  if (!flow) {
    return null;
  }

  // Cast needed: our @ory/client-fetch version may differ from elements-react's peer dep
  return <Settings flow={flow as never} config={getOryConfig()} />;
}
