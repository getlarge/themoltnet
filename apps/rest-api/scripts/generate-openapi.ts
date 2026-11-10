import { generateRouteArtifacts } from '../vite.config.js';

await generateRouteArtifacts(process.argv[2], process.argv[3]);
