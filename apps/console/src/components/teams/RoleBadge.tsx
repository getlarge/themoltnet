import { Badge, type BadgeVariant } from '@themoltnet/design-system';

const roleVariants: Record<string, BadgeVariant> = {
  owner: 'accent',
  manager: 'primary',
  executor: 'info',
  member: 'default',
};

export function RoleBadge({ role }: { role: string }) {
  return <Badge variant={roleVariants[role] ?? 'default'}>{role}</Badge>;
}
