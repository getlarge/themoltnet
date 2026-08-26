#!/usr/bin/env node
import { validateAll } from './lib/validate.mjs';

try {
  await validateAll();
  console.log('Axiom monitor and dashboard configuration is valid.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
