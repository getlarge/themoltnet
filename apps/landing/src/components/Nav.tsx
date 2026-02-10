import { Button, Logo, useTheme } from '@moltnet/design-system';
import { Link, useLocation } from 'wouter';

import { GITHUB_REPO_URL } from '../constants';

type NavItem =
  | { label: string; href: string; type: 'anchor' }
  | { label: string; href: string; type: 'route' };

const navItems: NavItem[] = [
  { label: 'Story', href: '/story', type: 'route' },
  { label: 'Why', href: '/#why', type: 'anchor' },
  { label: 'Stack', href: '/#stack', type: 'anchor' },
  { label: 'Manifesto', href: '/manifesto', type: 'route' },
  { label: 'Architecture', href: '/architecture', type: 'route' },
  { label: 'Status', href: '/#status', type: 'anchor' },
];

export function Nav() {
  const theme = useTheme();

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
        <Link href="/" style={{ display: 'flex', alignItems: 'center' }}>
          <Logo variant="wordmark" size={28} glow={false} />
        </Link>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing[8],
          }}
        >
          {navItems.map((item) =>
            item.type === 'route' ? (
              <RouteLink key={item.label} href={item.href} label={item.label} />
            ) : (
              <AnchorLink
                key={item.label}
                href={item.href}
                label={item.label}
              />
            ),
          )}
        </div>

        <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
          <Button variant="secondary" size="sm">
            GitHub
          </Button>
        </a>
      </div>
    </nav>
  );
}

function linkStyle(theme: ReturnType<typeof useTheme>) {
  return {
    fontSize: theme.font.size.sm,
    color: theme.color.text.muted,
    transition: `color ${theme.transition.fast}`,
  };
}

function AnchorLink({ href, label }: { href: string; label: string }) {
  const theme = useTheme();
  const [location, navigate] = useLocation();

  const handleClick = (e: React.MouseEvent) => {
    const hash = href.replace('/', '');
    if (location === '/') {
      // Already on home — let browser handle hash scroll
      return;
    }
    // Navigate to home first, then scroll to section
    e.preventDefault();
    navigate('/');
    requestAnimationFrame(() => {
      const el = document.querySelector(hash);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    });
  };

  return (
    <a
      href={href}
      onClick={handleClick}
      style={linkStyle(theme)}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = theme.color.text.DEFAULT;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = theme.color.text.muted;
      }}
    >
      {label}
    </a>
  );
}

function RouteLink({ href, label }: { href: string; label: string }) {
  const theme = useTheme();
  return (
    <Link
      href={href}
      style={linkStyle(theme)}
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
