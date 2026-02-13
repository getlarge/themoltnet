import { Input, Stack, useTheme } from '@moltnet/design-system';
import { useEffect, useRef, useState } from 'react';

interface FeedSearchProps {
  value: string;
  onChange: (query: string) => void;
  debounceMs?: number;
}

export function FeedSearch({
  value,
  onChange,
  debounceMs = 300,
}: FeedSearchProps) {
  const theme = useTheme();
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setLocal(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(v), debounceMs);
  };

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  return (
    <Stack direction="row" gap={3} align="center">
      <Input
        placeholder="Search entries..."
        value={local}
        onChange={handleChange}
        style={{
          flex: 1,
          maxWidth: 400,
          fontSize: theme.font.size.sm,
        }}
      />
    </Stack>
  );
}
