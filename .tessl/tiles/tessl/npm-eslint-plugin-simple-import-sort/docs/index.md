# ESLint Plugin Simple Import Sort

ESLint Plugin Simple Import Sort provides easy autofixable import and export sorting functionality. It automatically sorts import and export statements via `eslint --fix` with intelligent grouping and ordering rules, handles comments and type imports/exports, and is compatible with TypeScript/Prettier/dprint toolchains.

## Package Information

- **Package Name**: eslint-plugin-simple-import-sort
- **Package Type**: npm
- **Language**: JavaScript/TypeScript
- **Installation**: `npm install --save-dev eslint-plugin-simple-import-sort`
- **Peer Dependencies**: ESLint >=5.0.0

## Core Imports

```javascript
// ESM (Flat Config)
import simpleImportSort from 'eslint-plugin-simple-import-sort';

// CommonJS (eslintrc)
const simpleImportSort = require('eslint-plugin-simple-import-sort');
```

For TypeScript:

```typescript
import type { ESLint } from 'eslint';
import simpleImportSort from 'eslint-plugin-simple-import-sort';

// The plugin conforms to ESLint.Plugin type
const plugin: ESLint.Plugin = simpleImportSort;
```

## Basic Usage

```javascript
// Flat config (eslint.config.js)
import simpleImportSort from "eslint-plugin-simple-import-sort";

export default [
  {
    plugins: {
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
    },
  },
];

// Legacy eslintrc config
{
  "plugins": ["simple-import-sort"],
  "rules": {
    "simple-import-sort/imports": "error",
    "simple-import-sort/exports": "error"
  }
}
```

## Architecture

The plugin is structured around three main components:

- **Plugin Structure**: Standard ESLint plugin export with metadata and rules
- **Imports Rule**: Sorts import statements with configurable grouping patterns
- **Exports Rule**: Sorts export statements with comment-based grouping
- **Shared Utilities**: Common functionality for parsing, sorting, and code generation

### Key Features

- Runs via `eslint --fix` with no additional tooling required
- Handles comments and preserves them during sorting
- Supports TypeScript type imports/exports (`import type`)
- Compatible with Prettier, dprint, and eslint-plugin-import
- Git diff friendly (consistent sorting reduces diff noise)
- No runtime dependencies beyond ESLint

### Limitations

- Does not support `require()` statements (ES modules and import/export only)
- Limited configuration options (intentionally simple)
- Side effect imports maintain original order (not sorted internally)

## Capabilities

### Plugin Export

Main ESLint plugin object conforming to the ESLint plugin specification.

```javascript { .api }
/**
 * Main ESLint plugin export with metadata and rules
 */
const eslintPluginSimpleImportSort = {
  meta: {
    name: 'eslint-plugin-simple-import-sort',
    version: string,
  },
  rules: {
    imports: ESLintRule,
    exports: ESLintRule,
  },
};
```

### Imports Rule

Automatically sorts import statements with configurable grouping.

```javascript { .api }
/**
 * ESLint rule for sorting import statements
 * @param context - ESLint rule context
 * @returns ESLint rule object with visitor methods
 */
const importsRule = {
  meta: {
    type: "layout",
    fixable: "code",
    schema: [{
      type: "object",
      properties: {
        groups: {
          type: "array",
          items: {
            type: "array",
            items: {
              type: "string"
            }
          }
        }
      },
      additionalProperties: false
    }],
    docs: {
      url: "https://github.com/lydell/eslint-plugin-simple-import-sort#sort-order",
      description: "Automatically sort imports."
    },
    messages: {
      sort: "Run autofix to sort these imports!"
    }
  },
  create: (context: ESLintRuleContext) => ESLintRuleVisitor
};
```

**Configuration Options:**

The imports rule accepts a `groups` option to customize import grouping:

```javascript
{
  "simple-import-sort/imports": ["error", {
    "groups": [
      // Side effect imports
      ["^\\u0000"],
      // Node.js builtins prefixed with `node:`
      ["^node:"],
      // Packages (npm packages and Node.js builtins)
      ["^@?\\w"],
      // Absolute imports and other imports
      ["^"],
      // Relative imports
      ["^\\."]
    ]
  }]
}
```

**Default Grouping Behavior:**

1. Side effect imports (`import "./setup"`) - These maintain their original order
2. Node.js builtins with `node:` prefix (`import fs from "node:fs"`)
3. Third-party packages (`import react from "react"`) - Includes npm packages and Node.js builtins without `node:` prefix
4. Absolute imports and other imports (`import utils from "/utils"`, `import "@/components"`)
5. Relative imports (`import utils from "./utils"`, `import data from "../data"`)

### Exports Rule

Automatically sorts export statements, particularly export-from statements.

```javascript { .api }
/**
 * ESLint rule for sorting export statements
 * @param context - ESLint rule context
 * @returns ESLint rule object with visitor methods
 */
const exportsRule = {
  meta: {
    type: "layout",
    fixable: "code",
    schema: [],
    docs: {
      url: "https://github.com/lydell/eslint-plugin-simple-import-sort#sort-order",
      description: "Automatically sort exports."
    },
    messages: {
      sort: "Run autofix to sort these exports!"
    }
  },
  create: (context: ESLintRuleContext) => ESLintRuleVisitor
};
```

**Export Sorting Behavior:**

- Sorts `export * from "module"` and `export { name } from "module"` statements
- Sorts named exports within braces (`export { c, a, b }` becomes `export { a, b, c }`)
- Groups exports manually using comments (comments on their own line start a new group)
- Does not reorder other export types (`export const`, `export function`, etc.)

### Default Import Groups

Default grouping patterns used by the imports rule.

```javascript { .api }
/**
 * Default import grouping patterns
 */
const defaultGroups = [
  ['^\\u0000'], // Side effect imports
  ['^node:'], // Node.js builtins prefixed with `node:`
  ['^@?\\w'], // Packages
  ['^'], // Absolute imports and other imports
  ['^\\.'], // Relative imports
];
```

### Sorting Algorithm

The plugin uses `Intl.Collator` for human-friendly alphabetical sorting.

```javascript { .api }
/**
 * Collator configuration used for sorting
 */
const collator = new Intl.Collator("en", {
  sensitivity: "base",    // Case-insensitive comparison
  numeric: true          // Numeric sorting (img2 before img10)
});

/**
 * Comparison function used throughout the plugin
 * @param a - First string to compare
 * @param b - Second string to compare
 * @returns Comparison result (-1, 0, 1)
 */
function compare(a: string, b: string): number;
```

**Sorting Behavior:**

- Case-insensitive alphabetical sorting
- Numeric sorting (treats numbers naturally: `img2` comes before `img10`)
- Directory structure aware (`./../utils` before `./utils`)
- Type imports come before regular imports from the same source
- Side effect imports maintain their original order within their group

### Shared Utilities

Internal utility functions used by both rules (not part of public API but important for understanding behavior).

```javascript { .api }
/**
 * Core utility functions for import/export processing
 */
interface SharedUtilities {
  extractChunks(parentNode: ASTNode, isPartOfChunk: Function): Array<Array<ASTNode>>;
  maybeReportSorting(context: ESLintRuleContext, sorted: string, start: number, end: number): void;
  printSortedItems(sortedItems: Array<Array<Item>>, originalItems: Array<Item>, sourceCode: SourceCode): string;
  getImportExportItems(chunk: Array<ASTNode>, sourceCode: SourceCode, isSideEffectImport: Function, getSpecifiers: Function): Array<Item>;
  sortImportExportItems(items: Array<Item>): Array<Item>;
  sortSpecifierItems(items: Array<SpecifierItem>): Array<SpecifierItem>;
  printWithSortedSpecifiers(node: ASTNode, sourceCode: SourceCode, getSpecifiers: Function): string;
  getSourceCode(context: ESLintRuleContext): SourceCode;
  compare(a: string, b: string): number;
}

/**
 * Utility functions for import/export classification
 */
function isSideEffectImport(node: ASTNode, sourceCode: SourceCode): boolean;
function getSpecifiers(node: ASTNode): Array<ASTNode>;
function isImport(node: ASTNode): boolean;
function isExportFrom(node: ASTNode): boolean;
function getSource(node: ASTNode): SourceInfo;
function getImportExportKind(node: ASTNode): "type" | "value";
```

## Types

```javascript { .api }
/**
 * ESLint rule context object
 */
interface ESLintRuleContext {
  options: Array<any>;
  getSourceCode(): SourceCode;
  report(descriptor: ReportDescriptor): void;
}

/**
 * ESLint rule visitor object
 */
interface ESLintRuleVisitor {
  ImportDeclaration?: (node: ASTNode) => void;
  ExportNamedDeclaration?: (node: ASTNode) => void;
  ExportAllDeclaration?: (node: ASTNode) => void;
  "Program:exit"?: () => void;
}

/**
 * ESLint rule object
 */
interface ESLintRule {
  meta: {
    type: "layout" | "problem" | "suggestion";
    fixable?: "code" | "whitespace";
    schema: Array<object>;
    docs: {
      url: string;
      description: string;
    };
    messages: {
      [key: string]: string;
    };
  };
  create: (context: ESLintRuleContext) => ESLintRuleVisitor;
}

/**
 * Import/export item used internally for sorting
 */
interface Item {
  node: ASTNode;
  code: string;
  start: number;
  end: number;
  isSideEffectImport: boolean;
  source: SourceInfo;
  index: number;
  needsNewline: boolean;
}

/**
 * Source information for import/export statements
 */
interface SourceInfo {
  source: string;
  originalSource: string;
  kind: "value" | "type";
}

/**
 * Specifier item for sorting within import/export braces
 */
interface SpecifierItem {
  node: ASTNode;
  before: Array<Token>;
  specifier: Array<Token>;
  after: Array<Token>;
  index: number;
}

/**
 * AST Node representing import/export statements
 */
interface ASTNode {
  type: string;
  range: [number, number];
  loc: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  parent?: ASTNode;
  body?: Array<ASTNode>;
  source?: {
    value: string;
    type: string;
  };
  specifiers?: Array<ASTNode>;
  imported?: { name: string };
  exported?: { name: string };
  local?: { name: string };
}

/**
 * Source code utilities from ESLint
 */
interface SourceCode {
  getText(): string;
  getCommentsBefore(node: ASTNode): Array<Comment>;
  getCommentsAfter(node: ASTNode): Array<Comment>;
  getTokenAfter(node: ASTNode, options?: any): Token;
  getTokenBefore(node: ASTNode, options?: any): Token;
  getLastTokens(node: ASTNode, options: { count: number }): Array<Token>;
  getLocFromIndex(index: number): { line: number; column: number };
}

/**
 * Token or comment from the AST
 */
interface Token {
  type: string;
  value: string;
  range: [number, number];
  loc: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

/**
 * Comment from the AST
 */
interface Comment extends Token {
  type: "Block" | "Line";
}
```

## Usage Examples

### Basic Import Sorting

```javascript
// Before sorting
import React from "react";
import Button from "../Button";
import styles from "./styles.css";
import type { User } from "../../types";
import { getUser } from "../../api";
import PropTypes from "prop-types";
import classnames from "classnames";

// After sorting (automatically fixed by ESLint)
import classnames from "classnames";
import PropTypes from "prop-types";
import React from "react";

import { getUser } from "../../api";
import type { User } from "../../types";
import Button from "../Button";
import styles from "./styles.css";
```

### Custom Import Grouping

```javascript
{
  "simple-import-sort/imports": ["error", {
    "groups": [
      // React first
      ["^react$"],
      // Other packages
      ["^@?\\w"],
      // Internal imports
      ["^@/"],
      // Relative imports
      ["^\\."]
    ]
  }]
}
```

**Advanced Custom Grouping Patterns:**

The `groups` option uses regex patterns to match import sources. Each import is matched against all regexes, and the import goes to the group with the longest match. In case of a tie, the first matching regex wins.

```javascript
{
  "simple-import-sort/imports": ["error", {
    "groups": [
      // Side effect imports (special marker: \u0000 prepended)
      ["^\\u0000"],
      // Node.js builtins with node: prefix
      ["^node:"],
      // Packages: things that start with a letter (or digit or underscore), or @ followed by a letter
      ["^@?\\w"],
      // Absolute imports and other imports
      ["^"],
      // Relative imports: anything that starts with a dot
      ["^\\."]
    ]
  }]
}
```

**Special Markers:**

- Side effect imports: `\u0000` prepended (match with `^\\u0000`)
- Type imports: `\u0000` appended (match with `\\u0000$`)

**Side Effect Import Definition:**
A side effect import is an import statement with no imported bindings:

```javascript
import './polyfill'; // Side effect import ✓
import 'some-setup'; // Side effect import ✓
import {} from 'module'; // NOT a side effect import ✗ (empty import)
import * as ns from 'mod'; // NOT a side effect import ✗ (namespace import)
```

**Example - Separate Style Imports:**

```javascript
{
  "groups": [
    ["^\\u0000"],
    ["^@?\\w"],
    // Style imports
    ["\\.s?css$"],
    ["^"],
    ["^\\."]
  ]
}
```

### Export Sorting with Comments

```javascript
// Exports are grouped by comments
export * from "a";
export * from "z";

// This comment starts a new group
export * from "b";
export * from "y";

// Named exports are sorted within braces
export { zebra, alpha, beta } from "module";
// Becomes: export { alpha, beta, zebra } from "module";

// Import specifiers are also sorted within braces
import { zebra, alpha, beta, type User } from "module";
// Becomes: import { alpha, beta, type User, zebra } from "module";
// Note: type specifiers are sorted as if 'type' keyword wasn't there
```

### Integration with Other ESLint Rules

```javascript
{
  "plugins": ["simple-import-sort", "import"],
  "rules": {
    "simple-import-sort/imports": "error",
    "simple-import-sort/exports": "error",
    "import/first": "error",
    "import/newline-after-import": "error",
    "import/no-duplicates": "error"
  }
}
```
