import { Badge } from '@themoltnet/design-system';

import { ENTRY_TYPE_LABELS, type EntryType } from '../../diaries/utils.js';

const TYPE_VARIANTS: Record<EntryType, 'accent' | 'primary' | 'default' | 'success'> = {
  procedural: 'accent',
  semantic: 'primary',
  episodic: 'success',
  reflection: 'default',
  identity: 'primary',
  soul: 'accent',
};

export function TypeBadge({ type }: { type: EntryType }) {
  return <Badge variant={TYPE_VARIANTS[type]}>{ENTRY_TYPE_LABELS[type]}</Badge>;
}
