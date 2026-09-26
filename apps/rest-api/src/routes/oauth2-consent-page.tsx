import { OPERATOR_OAUTH } from '@moltnet/models';
import {
  Button,
  Card,
  DescriptionList,
  Logo,
  MoltThemeProvider,
  Stack,
  Text,
} from '@themoltnet/design-system';
// This route intentionally uses React's server-only renderer. It emits static
// HTML and does not import a browser DOM runtime into the REST API.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { renderToStaticMarkup } from 'react-dom/server';

export interface ConsentPageModel {
  challenge: string;
  clientName: string;
  heading: string;
  summary: string;
  agent?: string;
  team?: string;
  scopes: string[];
  audiences: string[];
  lifetime: string;
}

const SCOPE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  openid: 'Confirm your signed-in identity',
  profile: 'Share your username',
  email: 'Share your email address and verification status',
  offline: 'Keep access after this browser session ends',
  offline_access: 'Keep access after this browser session ends',
  'agent:profile': 'Read the authenticated agent profile',
  'connector:invoke': 'Invoke configured connectors',
  'crypto:sign': 'Create cryptographic signatures',
  'diary:manage': 'Manage diaries and access grants',
  'diary:read': 'Read diary entries and metadata',
  'diary:write': 'Create diary entries',
  'human:profile': 'Read your human profile',
  'key:manage': 'Issue, list, and rotate agent keys',
  'pack:read': 'Read context and rendered packs',
  'pack:write': 'Create and update packs',
  'runtime:manage': 'Manage runtime configuration',
  'runtime:read': 'Read runtime configuration',
  'task:claim': 'Claim queued tasks',
  'task:execute': 'Execute and report task attempts',
  'task:manage': 'Cancel, delete, and manage task grants',
  'task:read': 'Read tasks and attempts',
  'task:write': 'Create tasks and edit task metadata',
  'team:join': 'Join teams using invitations',
  'team:manage': 'Manage teams and membership',
  'team:read': 'Read teams and membership',
  'moltnet:provision': 'Issue the approved agent team credential',
  'moltnet:local-control': 'Control this Agent Server instance',
};

const AUDIENCE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  [OPERATOR_OAUTH.provisioningAudience]: 'MoltNet credential provisioning',
  [OPERATOR_OAUTH.localControlAudience]: 'The requesting local Agent Server',
};

function safeLabel(value: string): string {
  return value
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '')
    .slice(0, 160);
}

function ConsentPage(model: ConsentPageModel) {
  const details = [
    { label: 'Application', value: <bdi>{safeLabel(model.clientName)}</bdi> },
    ...(model.agent
      ? [{ label: 'Agent', value: <bdi>{safeLabel(model.agent)}</bdi> }]
      : []),
    ...(model.team
      ? [{ label: 'Team', value: <bdi>{safeLabel(model.team)}</bdi> }]
      : []),
  ];
  return (
    <MoltThemeProvider mode="light">
      <main
        style={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '1.5rem',
        }}
      >
        <Card
          variant="elevated"
          padding="lg"
          style={{ maxWidth: '38rem', width: '100%' }}
        >
          <Stack gap={5}>
            <Stack direction="row" gap={3} align="center">
              <Logo variant="mark" size={44} glow={false} />
              <Text variant="overline" color="primary">
                MoltNet authorization
              </Text>
            </Stack>
            <Stack gap={2}>
              <Text as="h1" variant="h3">
                {model.heading}
              </Text>
              <Text color="secondary">{model.summary}</Text>
            </Stack>
            <DescriptionList items={details} columns={1} compact />
            <Stack gap={2}>
              <Text as="h2" variant="h4">
                Requested permissions
              </Text>
              <ul style={{ margin: 0, paddingInlineStart: '1.35rem' }}>
                {model.scopes.map((scope) => (
                  <li key={scope} style={{ marginBlock: '0.4rem' }}>
                    <Text as="span">
                      {SCOPE_DESCRIPTIONS[scope] ?? safeLabel(scope)}
                    </Text>{' '}
                    <Text as="span" variant="caption" color="muted" mono>
                      ({safeLabel(scope)})
                    </Text>
                  </li>
                ))}
              </ul>
            </Stack>
            <Stack gap={2}>
              <Text as="h2" variant="h4">
                Access target
              </Text>
              <ul style={{ margin: 0, paddingInlineStart: '1.35rem' }}>
                {model.audiences.map((audience) => (
                  <li key={audience} style={{ marginBlock: '0.4rem' }}>
                    <Text as="span">
                      {AUDIENCE_DESCRIPTIONS[audience] ?? safeLabel(audience)}
                    </Text>
                  </li>
                ))}
              </ul>
              <Text variant="caption" color="secondary">
                {model.lifetime}
              </Text>
            </Stack>
            <form method="post" action="/oauth2/consent">
              <input
                type="hidden"
                name="consent_challenge"
                value={model.challenge}
              />
              <Stack direction="row" gap={3}>
                <Button type="submit" name="decision" value="allow">
                  Allow
                </Button>
                <Button
                  type="submit"
                  name="decision"
                  value="deny"
                  variant="secondary"
                >
                  Deny
                </Button>
              </Stack>
            </form>
          </Stack>
        </Card>
      </main>
    </MoltThemeProvider>
  );
}

export function renderConsentPage(model: ConsentPageModel): string {
  return `<!doctype html>${renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>{`${model.heading} · MoltNet`}</title>
      </head>
      <body style={{ margin: 0 }}>
        <ConsentPage {...model} />
      </body>
    </html>,
  )}`;
}
