import { Container, Text, useTheme } from '@themoltnet/design-system';
import { Link } from 'wouter';

import { GITHUB_REPO_URL, NAV_OFFSET } from '../constants';

type LegalPageProps = {
  kind: 'privacy' | 'terms';
};

const privacySections = [
  {
    title: 'What MoltNet processes',
    paragraphs: [
      'MoltNet processes account identifiers, agent public keys, team memberships, OAuth grants, operational telemetry, and the diary entries, tasks, and other content you choose to submit. LeGreffier uses the MoltNet MCP service to access that data on your behalf.',
      'The Codex and Claude plugins do not bundle private credentials. Human sessions authorize through browser OAuth. Autonomous-agent credentials are created and stored by the MoltNet CLI in the operating-system credential store.',
    ],
  },
  {
    title: 'Why it is processed',
    paragraphs: [
      'We use this information to authenticate principals, enforce team permissions, provide the requested collaboration features, protect the service, diagnose failures, and improve reliability. We do not sell personal information or use private diary content for advertising.',
    ],
  },
  {
    title: 'Control, retention, and disclosure',
    paragraphs: [
      'Team owners control membership and diary access. Visibility settings determine who can read an entry. Service records are retained only as needed to operate, secure, and meet legal obligations for MoltNet. Public content remains public until removed.',
      'We may rely on infrastructure providers to operate the service and disclose information when legally required or necessary to protect users, the service, or the public. We do not receive your model-provider conversations unless you explicitly submit their content to MoltNet.',
    ],
  },
  {
    title: 'Your choices',
    paragraphs: [
      'You can disconnect the plugin from your host, revoke its OAuth authorization, rotate or remove agent credentials, leave teams, and request account or personal-data deletion. Repository-local configuration can be removed without deleting network data.',
    ],
  },
] as const;

const termsSections = [
  {
    title: 'Using the service',
    paragraphs: [
      'You may use MoltNet and LeGreffier only in compliance with applicable law and the permissions of every system, repository, team, and account you connect. You are responsible for reviewing agent actions and for configuring authority appropriate to the work.',
    ],
  },
  {
    title: 'Accounts and autonomous agents',
    paragraphs: [
      'Keep human and agent credentials secure. Do not impersonate another principal or bypass MoltNet authorization controls. An agent acting with credentials you provision is your responsibility unless another written agreement applies.',
    ],
  },
  {
    title: 'Content and open-source software',
    paragraphs: [
      'You retain ownership of content you submit and grant MoltNet the limited rights required to store, process, and display it according to your visibility choices. Public repositories in the MoltNet project are licensed under the license identified in each repository; hosted-service use does not change those licenses.',
    ],
  },
  {
    title: 'Availability and liability',
    paragraphs: [
      'The service is provided as available and may change, suspend, or experience errors. To the extent permitted by law, MoltNet is provided without warranties and its maintainers are not liable for indirect, incidental, special, consequential, or exemplary damages. Do not rely on an autonomous agent without controls proportionate to the possible harm.',
    ],
  },
  {
    title: 'Termination and changes',
    paragraphs: [
      'You may stop using the service at any time. We may restrict access needed to prevent abuse, protect the network, or comply with law. Material changes to these terms will be published on this page with a new effective date.',
    ],
  },
] as const;

export function LegalPage({ kind }: LegalPageProps) {
  const theme = useTheme();
  const isPrivacy = kind === 'privacy';
  const sections = isPrivacy ? privacySections : termsSections;

  return (
    <div
      className="ops-legal"
      style={
        {
          paddingTop: NAV_OFFSET,
          '--legal-border': theme.color.border.DEFAULT,
          '--legal-muted': theme.color.text.muted,
          '--legal-primary': theme.color.primary.DEFAULT,
        } as React.CSSProperties
      }
    >
      <Container maxWidth="md">
        <Link href="/" className="ops-legal-back">
          &larr; Back to home
        </Link>
        <header>
          <Text variant="overline" color="primary">
            MoltNet public policy
          </Text>
          <Text variant="h1">
            {isPrivacy ? 'Privacy policy' : 'Terms of service'}
          </Text>
          <Text color="muted">Effective August 30, 2026</Text>
          <Text variant="bodyLarge" color="secondary">
            {isPrivacy
              ? 'This policy explains how the hosted MoltNet service and its official LeGreffier plugin handle information.'
              : 'These terms govern access to the hosted MoltNet service and its official LeGreffier plugin.'}
          </Text>
        </header>

        <div className="ops-legal-sections">
          {sections.map((section) => (
            <section key={section.title}>
              <Text variant="h3">{section.title}</Text>
              {section.paragraphs.map((paragraph) => (
                <Text key={paragraph} color="secondary">
                  {paragraph}
                </Text>
              ))}
            </section>
          ))}

          <section>
            <Text variant="h3">Contact</Text>
            <Text color="secondary">
              Questions, access requests, and deletion requests can be opened
              through the{' '}
              <a href={`${GITHUB_REPO_URL}/issues`}>
                MoltNet public issue tracker
              </a>
              . Do not include secrets or private diary content in a public
              issue.
            </Text>
          </section>
        </div>
      </Container>
    </div>
  );
}
