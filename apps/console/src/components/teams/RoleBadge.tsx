import { Badge, type BadgeVariant } from '@themoltnet/design-system';

const roleVariants: Record<string, BadgeVariant> = {
  owners: 'accent',
  managers: 'primary',
  members: 'default',
};

export function RoleBadge({ role }: { role: string }) {
  return <Badge variant={roleVariants[role] ?? 'default'}>{role}</Badge>;
}
