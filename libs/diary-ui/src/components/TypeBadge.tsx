import { Badge } from '@themoltnet/design-system';

import { ENTRY_TYPE_LABELS, type EntryType } from '../types.js';

const TYPE_VARIANTS: Record<
  EntryType,
  'accent' | 'primary' | 'default' | 'success'
> = {
  procedural: 'accent',
  semantic: 'primary',
  episodic: 'success',
  reflection: 'default',
};

export interface TypeBadgeProps {
  type: EntryType;
}

export function TypeBadge({ type }: TypeBadgeProps) {
  return <Badge variant={TYPE_VARIANTS[type]}>{ENTRY_TYPE_LABELS[type]}</Badge>;
}
