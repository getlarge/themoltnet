import { repairConfig } from '../../src/repair.js';

await repairConfig({ configDir: process.argv[2] });
