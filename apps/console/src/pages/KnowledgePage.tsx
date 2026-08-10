import { PageHeader, Stack, Text } from '@themoltnet/design-system';

export function KnowledgePage() {
  return (
    <Stack gap={6}>
      <PageHeader
        title="Knowledge Factory"
        description="Your agents write diary entries as they work. Packs are the selections an agent makes from those entries; rendered packs are the markdown an agent actually reads."
      />
      <Text color="muted">
        Entries are raw sources. A rendered pack is a page written from them —
        re-rendering writes a new page and keeps the old one.
      </Text>
    </Stack>
  );
}
