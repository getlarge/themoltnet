import { ActionLink, Logo } from '@themoltnet/design-system';
import { useEffect, useId, useState } from 'react';
import { Link, useLocation } from 'wouter';

import { getConfig } from '../config';
import { CONSOLE_BASE_URL, GITHUB_REPO_URL } from '../constants';
import { DOCS_HUB_PATH, docsHref } from '../journey';

/** Page order: the authority plane precedes the three chapters it governs. */
const systemLinks = [
  ['Identity & Authority', '/#identity-authority'],
  ['Task Engine', '/#task-engine'],
  ['Agent Runtime', '/#agent-runtime'],
  ['Knowledge Factory', '/#knowledge-factory'],
] as const;

/**
 * One filled action per viewport: the hero owns it on the home route, so the
 * nav button steps down to secondary there and fills in everywhere else.
 */
export function Nav() {
  const { docsUrl } = getConfig();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const onHome = location === '/';

  useEffect(() => {
    setOpen(false);
  }, [location]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const gettingStartedHref = docsHref(docsUrl, DOCS_HUB_PATH);
  const utilityLinks = [
    { label: 'Download', href: '/download', external: false },
    { label: 'Docs', href: docsUrl, external: true },
    { label: 'GitHub', href: GITHUB_REPO_URL, external: true },
    { label: 'Console', href: CONSOLE_BASE_URL, external: true },
  ] as const;

  const renderUtilityLink = (
    { label, href, external }: (typeof utilityLinks)[number],
    className?: string,
  ) => {
    if (!external) {
      return (
        <Link href={href} className={className} key={label}>
          {label}
        </Link>
      );
    }

    return (
      <a
        href={href}
        className={className}
        key={label}
        target="_blank"
        rel="noopener noreferrer"
      >
        {label}
      </a>
    );
  };

  return (
    <nav className="ops-nav" aria-label="Primary">
      <div className="ops-nav-inner">
        <Link href="/" aria-label="MoltNet home" className="ops-nav-brand">
          <Logo variant="wordmark" size={27} glow={false} />
          <span>control plane</span>
        </Link>

        <div className="ops-nav-systems" aria-label="Product systems">
          {systemLinks.map(([label, href]) => (
            <a href={href} key={label} onClick={() => setOpen(false)}>
              {label}
            </a>
          ))}
        </div>

        <div className="ops-nav-actions">
          <div className="ops-nav-utilities" aria-label="Resources">
            {utilityLinks.map((link) =>
              renderUtilityLink(link, 'ops-nav-utility'),
            )}
          </div>
          <div className="ops-nav-cta">
            <ActionLink
              href={gettingStartedHref}
              size="sm"
              variant={onHome ? 'secondary' : 'primary'}
            >
              Give an agent a job
            </ActionLink>
          </div>
          <button
            type="button"
            className="ops-nav-menu-toggle"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
          >
            <span>{open ? 'Close' : 'Menu'}</span>
            <span className="ops-nav-menu-icon" aria-hidden="true">
              <span />
              <span />
            </span>
          </button>
        </div>
      </div>

      <div
        id={panelId}
        className="ops-nav-panel"
        hidden={!open}
        aria-label="Site menu"
      >
        <div className="ops-nav-panel-group" aria-label="Product systems">
          <span>Systems</span>
          {systemLinks.map(([label, href]) => (
            <a href={href} key={label} onClick={() => setOpen(false)}>
              {label}
            </a>
          ))}
        </div>
        <div className="ops-nav-panel-group" aria-label="Operate">
          <span>Resources</span>
          {utilityLinks.map((link) => renderUtilityLink(link))}
        </div>
        <div className="ops-nav-panel-action">
          <span>Start here</span>
          <ActionLink
            href={gettingStartedHref}
            size="sm"
            variant={onHome ? 'secondary' : 'primary'}
          >
            Give an agent a job
          </ActionLink>
        </div>
      </div>
    </nav>
  );
}
