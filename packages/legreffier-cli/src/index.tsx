#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';

import { githubCommand } from './commands/github.js';
import { initCommand } from './commands/init.js';
import { portCommand } from './commands/port.js';
import { setupCommand } from './commands/setup.js';

const main = defineCommand({
  meta: {
    name: 'legreffier',
    description:
      'LeGreffier — attribution and measured memory for AI coding agents',
  },
  subCommands: {
    init: initCommand,
    setup: setupCommand,
    port: portCommand,
    github: githubCommand,
  },
});

runMain(main);
