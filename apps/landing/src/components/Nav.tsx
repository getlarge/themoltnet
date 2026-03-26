import { Button, Logo, useTheme } from '@themoltnet/design-system';
import { useEffect, useState } from 'react';
import { Link } from 'wouter';

import { GITHUB_REPO_URL } from '../constants';

function useIsMobile(breakpoint = 640) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
    setMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [breakpoint]);
  return mobile;
}

type NavItem = { label: string; href: string };

const navItems: NavItem[] = [
  { label: 'Get Started', href: '/getting-started' },
  { label: 'Architecture', href: '/architecture' },
  { label: 'Roadmap', href: '/roadmap' },
  { label: 'Feed', href: '/feed' },
  { label: 'Story', href: '/story' },
];

export function Nav() {
  const theme = useTheme();
  const mobile = useIsMobile();

  return (
    <nav
      style={{
        position: 'fixed',
        top: 0,
        zIndex: theme.zIndex.sticky,
        width: '100%',
        borderBottom: `1px solid ${theme.color.border.DEFAULT}`,
        background: `${theme.color.bg.void}ee`,
        backdropFilter: 'blur(12px)',
      }}
    >
      <div
        style={{
          maxWidth: '1280px',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `${theme.spacing[4]} ${theme.spacing[6]}`,
        }}
      >
        <Link
          href="/"
          style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
        >
          <Logo
            variant={mobile ? 'mark' : 'wordmark'}
            size={mobile ? 24 : 28}
            glow={false}
          />
        </Link>

        <div
          className="nav-links"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing[5],
            overflowX: 'auto',
            scrollbarWidth: 'none',
            WebkitOverflowScrolling: 'touch',
            margin: `0 ${theme.spacing[4]}`,
          }}
        >
          {navItems.map((item) => (
            <NavLink key={item.label} href={item.href} label={item.label} />
          ))}
        </div>

        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ flexShrink: 0 }}
        >
          <Button variant="secondary" size="sm">
            GitHub
          </Button>
        </a>
      </div>
    </nav>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  const theme = useTheme();
  return (
    <Link
      href={href}
      style={{
        fontSize: theme.font.size.sm,
        color: theme.color.text.muted,
        transition: `color ${theme.transition.fast}`,
        whiteSpace: 'nowrap' as const,
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
        e.currentTarget.style.color = theme.color.text.DEFAULT;
      }}
      onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
        e.currentTarget.style.color = theme.color.text.muted;
      }}
    >
      {label}
    </Link>
  );
}
