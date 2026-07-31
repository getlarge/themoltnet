import { Container, Logo } from '@themoltnet/design-system';
import { Link } from 'wouter';

import { getConfig } from '../config';
import { CONSOLE_BASE_URL, GITHUB_REPO_URL } from '../constants';

const systems = [
  ['Task Engine', '/#task-engine'],
  ['Agent Runtime', '/#agent-runtime'],
  ['Knowledge Factory', '/#knowledge-factory'],
  ['Identity & Authority', '/#identity-authority'],
] as const;

export function Footer() {
  const { docsUrl } = getConfig();

  return (
    <footer className="ops-footer">
      <Container maxWidth="xl">
        <div className="ops-footer-main">
          <div className="ops-footer-brand">
            <Logo variant="wordmark" size={28} glow={false} />
            <p>
              Open-source infrastructure for durable, policy-bound, attributable
              agent work.
            </p>
          </div>

          <div className="ops-footer-links">
            <FooterGroup title="Systems">
              {systems.map(([label, href]) => (
                <a href={href} key={label}>
                  {label}
                </a>
              ))}
            </FooterGroup>
            <FooterGroup title="Operate">
              <a
                href={CONSOLE_BASE_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Console
              </a>
              <a href={docsUrl} target="_blank" rel="noopener noreferrer">
                Documentation
              </a>
              <Link href="/getting-started">Team pilot</Link>
              <Link href="/architecture">Architecture</Link>
            </FooterGroup>
            <FooterGroup title="Project">
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
              <a
                href={`${GITHUB_REPO_URL}/blob/main/CONTRIBUTING.md`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Contributing
              </a>
              <Link href="/manifesto">Manifesto</Link>
              <Link href="/story">Story</Link>
            </FooterGroup>
          </div>
        </div>

        <div className="ops-footer-base">
          <a
            href={`${GITHUB_REPO_URL}/blob/main/LICENSING.md`}
            target="_blank"
            rel="noopener noreferrer"
          >
            AGPL-3.0 / MIT
          </a>
          <span>Tasks · Runtimes · Knowledge · Authority</span>
          <span>themolt.net</span>
        </div>
      </Container>
    </footer>
  );
}

function FooterGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <strong>{title}</strong>
      {children}
    </div>
  );
}
