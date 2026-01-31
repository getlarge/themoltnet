---
date: '2026-01-31T19:00:00Z'
author: claude-opus-4-5-20251101
session: session_01AZKGMLNAxeJDro3FMihiSn
type: discovery
importance: 0.7
tags: [typescript, project-references, monorepo, tsconfig, workspace-setup]
supersedes: null
signature: pending
---

# Discovery: TypeScript Project References in the MoltNet Monorepo

## What I Found

The MoltNet monorepo uses TypeScript project references to type-check all workspaces from a single root command without hacks like `exclude` arrays. This entry explains the three-layer tsconfig architecture and how to configure each workspace type.

## The Three Layers

### 1. `tsconfig.base.json` — Shared Compiler Options

Contains settings every workspace inherits. No module system, no paths, no file selection — just the compiler behavior that should be universal.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true
  }
}
```

Key: `composite: true` is here so every workspace that extends this base automatically satisfies the project references requirement. A composite project must have `declaration: true` (also set here) and must specify `include` or `files` (done in each workspace).

### 2. `tsconfig.json` — Solution File

The root config is a pure orchestrator. It compiles nothing itself (`files: []`), and declares which sub-projects exist via `references`.

```json
{
  "files": [],
  "references": [
    { "path": "libs/crypto-service" },
    { "path": "libs/database" },
    { "path": "libs/models" },
    { "path": "libs/observability" },
    { "path": "apps/landing" }
  ]
}
```

When you run `tsc -b` at the root, TypeScript builds each referenced project in dependency order. When you run `tsc -b --noEmit`, it type-checks without emitting.

### 3. Workspace `tsconfig.json` — Per-Project Config

Each workspace extends the base and adds its own module system, file selection, and output directory.

## Workspace Patterns

### Node.js Libraries (`libs/*`)

For backend libraries that emit CommonJS/ESM via Node's native module resolution:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "__tests__"]
}
```

Notes:

- `module: NodeNext` + `moduleResolution: NodeNext` — requires `.js` extensions on relative imports (e.g., `import { foo } from './foo.js'`)
- `outDir: ./dist` — tsc emits `.js` + `.d.ts` files here
- `rootDir: ./src` — preserves directory structure in output
- `__tests__` excluded from compilation but still type-checked by the test runner (vitest uses its own TS handling)

Exception: `libs/database` uses `rootDir: "."` instead of `"./src"` because it includes `drizzle.config.ts` at the package root.

### Frontend Apps (`apps/landing`)

For apps bundled by Vite (or similar), where tsc is only used for type-checking:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "isolatedModules": true,
    "outDir": "./dist/tsc",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

Notes:

- `module: ESNext` + `moduleResolution: bundler` — allows extensionless imports, JSX, and other bundler features that `NodeNext` forbids
- `jsx: react-jsx` — React 17+ automatic JSX transform
- `lib` includes `DOM` and `DOM.Iterable` — browser APIs
- `isolatedModules: true` — required by Vite (esbuild compiles each file independently)
- `outDir: ./dist/tsc` — separate from Vite's output (`./dist/`), since `composite` requires emit but Vite ignores it
- No `noEmit` — incompatible with `composite: true`. The emitted `.js` files in `dist/tsc/` are unused; Vite produces the real bundle

### Future: Backend Apps (`apps/mcp-server`, `apps/rest-api`)

When backend Fastify apps are built, they should follow the Node.js library pattern:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "__tests__"]
}
```

If they depend on other workspaces, add inter-project references:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { ... },
  "references": [
    { "path": "../../libs/database" },
    { "path": "../../libs/observability" }
  ],
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "__tests__"]
}
```

This tells `tsc -b` to build the dependencies first, and resolves their types through declaration files rather than path aliases.

## Adding a New Workspace — Checklist

1. Create the workspace directory with `package.json` and `tsconfig.json`
2. `tsconfig.json` extends `../../tsconfig.base.json`
3. Set `module`/`moduleResolution` based on the workspace type (NodeNext for backend, bundler for frontend)
4. Set `outDir` and `rootDir`
5. Add a `{ "path": "..." }` entry in the root `tsconfig.json` `references` array
6. If the workspace imports from another workspace, add a `references` entry in its own `tsconfig.json`
7. Run `npm install` to register the npm workspace

## Commands

| Command             | What It Does                                                                         |
| ------------------- | ------------------------------------------------------------------------------------ |
| `npm run typecheck` | `tsc -b --noEmit` — type-checks all referenced projects without emitting             |
| `npm run build`     | Runs each workspace's `build` script (tsc -b for libs, tsc -b + vite build for apps) |
| `tsc -b` (at root)  | Builds all referenced projects in dependency order                                   |
| `tsc -b --clean`    | Removes all build outputs from referenced projects                                   |

## Why Not `paths` Aliases?

The previous setup used `paths` in the root tsconfig to map `@moltnet/database` to `./libs/database/src/index.ts`. This works for IDE resolution but has drawbacks:

- Root tsconfig must set `module`/`moduleResolution` that works for ALL workspaces (impossible when mixing NodeNext and bundler)
- Files not matching the root config need `exclude` hacks
- No build ordering — tsc doesn't know workspace A depends on workspace B

With project references, cross-workspace resolution goes through `references` entries and declaration files. npm workspace linking handles runtime resolution. The `paths` hack is no longer needed.

## Why It Matters

Every future builder (agent or human) adding a workspace needs to understand this. Getting the tsconfig wrong causes confusing errors: missing `.js` extensions, JSX not recognized, types not found across workspaces, or circular reference loops. This entry should prevent those issues.
