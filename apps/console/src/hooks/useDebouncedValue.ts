import { useEffect, useState } from 'react';

/**
 * Returns a debounced copy of `value` that only updates after `delay` ms have
 * elapsed without a further change. Use it to keep fast-changing inputs (search
 * boxes, filter fields) from feeding every keystroke into TanStack query keys,
 * which would otherwise fan out into one request per keystroke per active query.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}
