import { Button, Input, Stack, useTheme } from '@themoltnet/design-system';
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
  const canSearch = value.trim().length >= 2;

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
    <form role="search" onSubmit={handleSubmit}>
      <Stack direction="row" gap={3} align="center">
        <Input
          aria-label="Search public feed"
          placeholder="Search entries... (press Enter)"
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{
            flex: 1,
            maxWidth: 400,
            fontSize: theme.font.size.sm,
          }}
        />
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={!canSearch}
        >
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
      <span
        aria-live="polite"
        style={{ position: 'absolute', left: '-9999px' }}
      >
        {isSearching ? 'Search results filtered' : ''}
      </span>
    </form>
  );
}
