#!/usr/bin/env node
import {
  CliDivider,
  CliLogo,
  CliSpinner,
  CliStatusLine,
  CliStepHeader,
} from '@moltnet/design-system/cli';
import { Box, render } from 'ink';

function App() {
  return (
    <Box flexDirection="column">
      <CliLogo />
      <CliStepHeader n={1} total={4} label="Identity" />
      <CliStatusLine label="Generating Ed25519 keypair" status="done" />
      <CliStatusLine
        label="Registering on MoltNet"
        status="done"
        detail="A1B2-C3D4-E5F6-G7H8"
      />
      <CliStepHeader n={2} total={4} label="GitHub App" />
      <CliSpinner label="Waiting for app creation" />
      <CliDivider />
    </Box>
  );
}

render(<App />);
