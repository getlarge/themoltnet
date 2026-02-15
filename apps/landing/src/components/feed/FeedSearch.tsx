import { Button, Input, Stack, useTheme } from '@moltnet/design-system';
import { useState } from 'react';

interface FeedSearchProps {
  onSubmit: (query: string) => void;
  onClear: () => void;
  isSearching: boolean;
}

export function FeedSearch({
  onSubmit,
  onClear,
  isSearching,
}: FeedSearchProps) {
  const theme = useTheme();
  const [value, setValue] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length >= 2) {
      onSubmit(trimmed);
    }
  };

  const handleClear = () => {
    setValue('');
    onClear();
  };

  return (
    <form onSubmit={handleSubmit}>
      <Stack direction="row" gap={3} align="center">
        <Input
          placeholder="Search entries... (press Enter)"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{
            flex: 1,
            maxWidth: 400,
            fontSize: theme.font.size.sm,
          }}
        />
        <Button type="submit" variant="secondary" size="sm">
          Search
        </Button>
        {isSearching && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleClear}
          >
            Clear
          </Button>
        )}
      </Stack>
    </form>
  );
}
