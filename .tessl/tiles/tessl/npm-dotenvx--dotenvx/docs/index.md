# @dotenvx/dotenvx

@dotenvx/dotenvx is a secure dotenv library and CLI tool that extends the original dotenv package with multi-environment support, encryption capabilities, and universal cross-platform compatibility. It serves as both a Node.js library for programmatic use and a CLI tool that works with any language or framework.

## Package Information

- **Package Name**: @dotenvx/dotenvx
- **Package Type**: npm
- **Language**: JavaScript/TypeScript
- **Installation**: `npm install @dotenvx/dotenvx`
- **Global CLI**: `curl -sfS https://dotenvx.sh | sh` or `npm install -g @dotenvx/dotenvx`

## Core Imports

```javascript
const { config, parse, set, get } = require('@dotenvx/dotenvx');
```

For TypeScript:

```typescript
import {
  config,
  parse,
  set,
  get,
  type DotenvConfigOptions,
} from '@dotenvx/dotenvx';
```

Auto-config import:

```javascript
require('@dotenvx/dotenvx/config'); // Automatically calls config()
```

## Basic Usage

```javascript
const dotenvx = require('@dotenvx/dotenvx');

// Load environment variables from .env files
const result = dotenvx.config();
console.log(result.parsed); // { KEY: 'value', ... }

// Parse env content directly
const parsed = dotenvx.parse('KEY=value\nANOTHER=test');
console.log(parsed); // { KEY: 'value', ANOTHER: 'test' }

// Set environment variables in .env files
dotenvx.set('API_KEY', 'secret-value');

// Get environment variables from .env files
const apiKey = dotenvx.get('API_KEY');
```

## Architecture

@dotenvx/dotenvx is built around several key components:

- **Core Library**: Backward-compatible dotenv API with enhanced capabilities
- **CLI Interface**: Command-line tool for managing environment variables across any language
- **Encryption System**: Built-in encryption for sensitive environment variables using public/private keypairs
- **Multi-Environment**: Support for multiple .env files (development, staging, production)
- **Service Layer**: Internal services handling file operations, encryption, and environment management
- **Extension System**: Pluggable architecture for additional functionality

## Capabilities

### Environment Loading

Core functionality for loading environment variables from .env files with support for encrypted files, multiple environments, and flexible configuration options.

```javascript { .api }
function config(options?: DotenvConfigOptions): DotenvConfigOutput;

interface DotenvConfigOptions {
  path?: string | string[] | URL;
  encoding?: string;
  overload?: boolean;
  override?: boolean;
  strict?: boolean;
  ignore?: string[];
  processEnv?: Record<string, string>;
  envKeysFile?: string;
  DOTENV_KEY?: string;
  convention?: string;
  debug?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  logLevel?: 'error' | 'warn' | 'success' | 'successv' | 'info' | 'help' | 'verbose' | 'debug';
}

interface DotenvConfigOutput {
  error?: Error;
  parsed?: Record<string, string>;
}
```

[Environment Loading](./environment-loading.md)

### Environment Management

Functions for reading, writing, and managing environment variables in .env files with support for encryption and multiple file formats.

```javascript { .api }
function parse(src: string | Buffer, options?: DotenvParseOptions): Record<string, string>;
function set(key: string, value: string, options?: SetOptions): SetOutput;
function get(key: string, options?: GetOptions): string | Record<string, string>;

interface SetOutput {
  processedEnvs: SetProcessedEnv[];
  changedFilepaths: string[];
  unchangedFilepaths: string[];
}
```

[Environment Management](./environment-management.md)

### File Operations

Utilities for discovering, listing, and managing .env files across projects with support for generating example files and managing project structure.

```javascript { .api }
function ls(directory?: string, envFile?: string | string[], excludeEnvFile?: string | string[]): string[];
function genexample(directory?: string, envFile?: string): GenExampleOutput;

interface GenExampleOutput {
  envExampleFile: string;
  envFile: string | string[];
  exampleFilepath: string;
  addedKeys: string[];
  injected: Record<string, string>;
  preExisted: Record<string, string>;
}
```

[File Operations](./file-operations.md)

### Encryption & Security

Encryption capabilities for securing sensitive environment variables using public/private key cryptography with automatic key management.

```javascript { .api }
function keypair(envFile?: string, key?: string, envKeysFile?: string): Record<string, any>;
```

[Encryption & Security](./encryption-security.md)

### CLI Commands

Command-line interface providing all library functionality plus additional tools for cross-platform environment variable management, git integration, and development workflow automation.

Key commands: `run`, `get`, `set`, `encrypt`, `decrypt`, `keypair`, `ls`, `rotate`, `prebuild`, `precommit`, and extensible `ext` commands.

[CLI Commands](./cli-commands.md)

### Logging & Utilities

Shared utilities for logging, formatting, and configuration that are exposed for use by extensions and advanced integrations.

```javascript { .api }
function setLogLevel(options: { logLevel?: string; debug?: boolean; verbose?: boolean; quiet?: boolean }): void;

const logger: {
  error(message: string): void;
  warn(message: string): void;
  success(message: string): void;
  successv(message: string): void;
  info(message: string): void;
  help(message: string): void;
  verbose(message: string): void;
  debug(message: string): void;
};

function getColor(name: string): (text: string) => string;
function bold(text: string): string;
```

[Logging & Utilities](./logging-utilities.md)

## Types

```typescript { .api }
interface DotenvParseOptions {
  overload?: boolean;
  override?: boolean;
  processEnv?: Record<string, string>;
  privateKey?: string;
}

interface SetOptions {
  path?: string | string[] | URL;
  envKeysFile?: string;
  convention?: string;
  encrypt?: boolean;
}

interface SetProcessedEnv {
  key: string;
  value: string;
  filepath: string;
  envFilepath: string;
  envSrc: string;
  changed: boolean;
  encryptedValue?: string;
  publicKey?: string;
  privateKey?: string;
  privateKeyAdded?: boolean;
  privateKeyName?: string;
  error?: Error;
}

interface GetOptions {
  ignore?: string[];
  overload?: boolean;
  envKeysFile?: string;
  strict?: boolean;
  all?: boolean;
  format?: 'eval' | 'shell';
}
```

## Missing Type Definitions

Some functions are exported from the JavaScript module but lack TypeScript definitions:

```typescript { .api }
/**
 * Generate or retrieve keypairs for encryption
 * @param envFile - Path to .env file to generate keys for
 * @param key - Specific keypair key to retrieve (optional)
 * @param envKeysFile - Path to .env.keys file (defaults to .env.keys)
 * @returns Object containing keypair data or specific key value
 */
function keypair(
  envFile?: string,
  key?: string,
  envKeysFile?: string,
): Record<string, any>;

/**
 * Configure the global log level for dotenvx operations
 * @param options - Logging configuration options
 */
function setLogLevel(options: {
  logLevel?:
    | 'error'
    | 'warn'
    | 'success'
    | 'successv'
    | 'info'
    | 'help'
    | 'verbose'
    | 'debug';
  debug?: boolean;
  verbose?: boolean;
  quiet?: boolean;
}): void;

/**
 * Logger instance with methods for different log levels
 */
const logger: {
  error(message: string): void;
  warn(message: string): void;
  success(message: string): void;
  successv(message: string): void;
  info(message: string): void;
  help(message: string): void;
  verbose(message: string): void;
  debug(message: string): void;
};

/**
 * Get a color formatting function
 */
function getColor(name: string): (text: string) => string;

/**
 * Apply bold formatting to text
 */
function bold(text: string): string;
```
