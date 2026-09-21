import { CopyButton, useTheme } from '@themoltnet/design-system';
import { createContext, type ReactNode, useContext } from 'react';

/**
 * Whether identifiers (UUIDs, CIDs, hashes) render shortened. Presentation
 * surfaces turn it on once at the root instead of threading a flag through
 * every component that shows an identifier.
 */
const CompactIdentifiersContext = createContext(false);

export function CompactIdentifiersProvider({
  compact,
  children,
}: {
  compact: boolean;
  children: ReactNode;
}) {
  return (
    <CompactIdentifiersContext.Provider value={compact}>
      {children}
    </CompactIdentifiersContext.Provider>
  );
}

export function useCompactIdentifiers() {
  return useContext(CompactIdentifiersContext);
}

/** `bafyreiw…4gq4lu`; values of 20 characters or fewer are unchanged. */
export function compactIdentifier(value: string, max = 20): string {
  if (value.length <= max) return value;
  const prefix = value.includes(':') ? value.indexOf(':') + 1 : 0;
  return `${value.slice(0, prefix + 8)}…${value.slice(-6)}`;
}

export interface IdentifierProps {
  value: string;
  /** Accessible name of a copy button; omit for no button. */
  copyLabel?: string;
}

/**
 * A raw identifier in mono. When compact, the full value stays in the
 * tooltip and in the copy button.
 */
export function Identifier({ value, copyLabel }: IdentifierProps) {
  const theme = useTheme();
  const compact = useCompactIdentifiers();
  const text = (
    <span
      title={compact && value.length > 20 ? value : undefined}
      style={{ fontFamily: theme.font.family.mono, overflowWrap: 'anywhere' }}
    >
      {compact ? compactIdentifier(value) : value}
    </span>
  );
  if (!copyLabel) return text;

  return (
    <span
      style={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: theme.spacing[2],
        maxWidth: '100%',
      }}
    >
      {text}
      <CopyButton value={value} text="Copy" size="sm" ariaLabel={copyLabel} />
    </span>
  );
}
