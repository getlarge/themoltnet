# Monorepo Package Publishing Pre-flight Audit

## Problem/Feature Description

A TypeScript monorepo managed with pnpm contains several packages. One of the packages, `@acme/analytics-widget`, is a Vite-built library that bundles several internal workspace packages into its output (i.e., Vite SSR/lib mode processes and inlines the workspace deps into the bundle). The team is preparing to publish it to npm for the first time.

A previous publishing incident at the company caused all downstream installs to fail with E404 errors for internal packages, despite the package building and testing successfully in the monorepo. The incident was traced back to how pnpm publish handles monorepo-internal dependencies. The team has learned that there are important rules about how workspace packages must be declared in `package.json` for a Vite-bundled library before it can be published to npm.

You have been given the current `package.json` for `@acme/analytics-widget` and asked to audit it, fix any issues that could cause a publishing failure, and write a `check-pack.sh` script that can be run before any future publish to catch this class of problem automatically.

## Output Specification

- `package.json` — the corrected package.json for `@acme/analytics-widget`
- `check-pack.sh` — a shell script that validates the package configuration is safe to publish and exits with a non-zero code if it finds problems
- `audit-report.md` — a brief report of what was wrong and what was changed

## Input Files (optional)

The following files are provided as inputs. Extract them before beginning.

=============== FILE: inputs/package.json ===============
{
"name": "@acme/analytics-widget",
"version": "0.2.0",
"main": "dist/index.js",
"types": "dist/index.d.ts",
"scripts": {
"build": "vite build",
"typecheck": "tsc --noEmit"
},
"dependencies": {
"@acme/ui-components": "workspace:_",
"@acme/data-utils": "workspace:_",
"@acme/api-client": "workspace:\*",
"react": "^18.2.0",
"react-dom": "^18.2.0"
},
"devDependencies": {
"typescript": "^5.4.0",
"vite": "^5.2.0",
"@types/react": "^18.2.0"
},
"peerDependencies": {
"react": "^18.2.0",
"react-dom": "^18.2.0"
}
}

=============== FILE: inputs/vite.config.ts ===============
import { defineConfig } from 'vite';

export default defineConfig({
build: {
lib: {
entry: 'src/index.ts',
formats: ['es', 'cjs'],
},
// Bundle workspace deps into the output
rollupOptions: {
external: ['react', 'react-dom'],
},
},
});
