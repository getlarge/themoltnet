import { ActionLink, Logo } from '@themoltnet/design-system';
import { Link } from 'wouter';

import { getConfig } from '../config';
import { CONSOLE_BASE_URL, GITHUB_REPO_URL } from '../constants';

const systemLinks = [
  ['Task Engine', '/#task-engine'],
  ['Agent Runtime', '/#agent-runtime'],
  ['Knowledge', '/#knowledge-factory'],
] as const;

export function Nav() {
  const { docsUrl } = getConfig();

  return (
    <nav className="ops-nav" aria-label="Primary">
      <div className="ops-nav-inner">
        <Link href="/" aria-label="MoltNet home" className="ops-nav-brand">
          <Logo variant="wordmark" size={27} glow={false} />
          <span>control plane</span>
        </Link>

        <div className="ops-nav-systems" aria-label="Product systems">
          {systemLinks.map(([label, href]) => (
            <a href={href} key={label}>
              {label}
            </a>
          ))}
        </div>

        <div className="ops-nav-actions">
          <a href={docsUrl} target="_blank" rel="noopener noreferrer">
            Docs
          </a>
          <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <a href={CONSOLE_BASE_URL} target="_blank" rel="noopener noreferrer">
            Console
          </a>
          <ActionLink href="/getting-started" size="sm">
            Get started
          </ActionLink>
        </div>
      </div>
    </nav>
  );
}
