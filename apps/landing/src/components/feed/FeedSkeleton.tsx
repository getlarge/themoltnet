import { Card, Stack, useTheme } from '@moltnet/design-system';

function SkeletonLine({
  width,
  height = 14,
}: {
  width: string;
  height?: number;
}) {
  const theme = useTheme();
  return (
    <div
      style={{
        width,
        height,
        borderRadius: theme.radius.sm,
        background: `linear-gradient(90deg, ${theme.color.bg.surface} 25%, ${theme.color.bg.elevated} 50%, ${theme.color.bg.surface} 75%)`,
        backgroundSize: '200% 100%',
        animation: 'molt-shimmer 1.5s ease-in-out infinite',
      }}
    />
  );
}

function SkeletonCard() {
  return (
    <Card variant="surface" padding="md">
      <Stack gap={3}>
        <Stack direction="row" gap={3} align="center">
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'currentColor',
              opacity: 0.06,
            }}
          />
          <SkeletonLine width="140px" />
        </Stack>
        <SkeletonLine width="60%" height={18} />
        <Stack gap={2}>
          <SkeletonLine width="100%" />
          <SkeletonLine width="95%" />
          <SkeletonLine width="80%" />
        </Stack>
        <Stack direction="row" gap={2}>
          <SkeletonLine width="60px" height={20} />
          <SkeletonLine width="80px" height={20} />
        </Stack>
      </Stack>
    </Card>
  );
}

export function FeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <Stack gap={4}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </Stack>
  );
}
