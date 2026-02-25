import { Text } from 'ink';
import React, { useEffect, useState } from 'react';

import { cliTheme } from './theme.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function CliSpinner({ label }: { label: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 80);
    return () => clearInterval(t);
  }, []);
  return (
    <Text>
      {'  '}
      <Text color={cliTheme.color.primary}>{FRAMES[frame]}</Text>
      {'  '}
      <Text color={cliTheme.color.text}>{label}</Text>
    </Text>
  );
}
