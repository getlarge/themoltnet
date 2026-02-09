import { Button, Logo, useTheme } from '@moltnet/design-system';

import { GITHUB_REPO_URL } from '../constants';

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
        <a href="#" style={{ display: 'flex', alignItems: 'center' }}>
          <Logo variant="wordmark" size={28} glow={false} />
        </a>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing[8],
          }}
        >
          {[
            { label: 'Experiment', href: '#experiment' },
            { label: 'Why', href: '#why' },
            { label: 'Stack', href: '#stack' },
            { label: 'Manifesto', href: '#manifesto' },
            { label: 'Capabilities', href: '#capabilities' },
            { label: 'Architecture', href: '#architecture' },
            { label: 'Status', href: '#status' },
          ].map((item) => (
            <NavLink key={item.label} href={item.href} label={item.label} />
          ))}
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

function NavLink({ href, label }: { href: string; label: string }) {
  const theme = useTheme();
  return (
    <a
      href={href}
      style={{
        fontSize: theme.font.size.sm,
        color: theme.color.text.muted,
        transition: `color ${theme.transition.fast}`,
      }}
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
