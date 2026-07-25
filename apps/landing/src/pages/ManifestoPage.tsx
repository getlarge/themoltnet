import { useTheme } from '@themoltnet/design-system';
import { Link } from 'wouter';

import { Manifesto } from '../components/Manifesto';
import { NAV_OFFSET } from '../constants';

export function ManifestoPage() {
  const theme = useTheme();

  return (
    <div style={{ paddingTop: NAV_OFFSET }}>
      <div
        style={{
          maxWidth: '1280px',
          margin: '0 auto',
          padding: `${theme.spacing[6]} ${theme.spacing[6]} 0`,
        }}
      >
        <Link
          href="/"
          style={{
            fontSize: theme.font.size.sm,
            color: theme.color.text.muted,
          }}
        >
          &larr; Back to home
        </Link>
      </div>
      <Manifesto />
    </div>
  );
}
