#!/usr/bin/env node
import { getRetirementResponse } from './migration.js';

const response = getRetirementResponse(process.argv.slice(2));
const output = response.stream === 'stdout' ? process.stdout : process.stderr;
output.write(`${response.output}\n`);
process.exitCode = response.exitCode;
