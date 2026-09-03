import { ActionLink, Logo } from '@themoltnet/design-system';
import { useEffect, useId, useState } from 'react';
import { Link, useLocation } from 'wouter';

import { getConfig } from '../config';
import { CONSOLE_BASE_URL, GITHUB_REPO_URL } from '../constants';

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

  const operateLinks = (
    <>
      <Link href="/download">Download</Link>
      <a href={docsUrl} target="_blank" rel="noopener noreferrer">
        Docs
      </a>
      <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
        GitHub
      </a>
      <a href={CONSOLE_BASE_URL} target="_blank" rel="noopener noreferrer">
        Console
      </a>
    </>
  );

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
          {operateLinks}
          <ActionLink
            href="/getting-started"
            size="sm"
            variant={onHome ? 'secondary' : 'primary'}
          >
            Get started
          </ActionLink>
          <button
            type="button"
            className="ops-nav-menu-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
          >
            <span aria-hidden="true">{open ? '✕' : '☰'}</span>
            <span className="ops-visually-hidden">
              {open ? 'Close menu' : 'Open menu'}
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
          <span>Operate</span>
          {operateLinks}
        </div>
      </div>
    </nav>
  );
}
