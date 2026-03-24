# Environment Loading

Core functionality for loading environment variables from .env files with support for encrypted files, multiple environments, and flexible configuration options.

## Capabilities

### Config Function

Loads .env file contents into process.env by default. If DOTENV_KEY is present, it smartly attempts to load encrypted .env.vault file contents into process.env.

```javascript { .api }
/**
 * Loads .env file contents into process.env (or custom environment object)
 * @param options - Configuration options for loading behavior
 * @returns Object containing parsed data and any errors encountered
 */
function config(options?: DotenvConfigOptions): DotenvConfigOutput;

interface DotenvConfigOptions {
  /** Custom path(s) to .env file(s). Can be string, array of strings, or URL */
  path?: string | string[] | URL;
  /** File encoding for reading .env files */
  encoding?: string;
  /** Override existing environment variables with values from .env files */
  overload?: boolean;
  /** Alias for overload */
  override?: boolean;
  /** Throw immediately if an error is encountered (like missing .env file) */
  strict?: boolean;
  /** Suppress specific error codes (e.g., ['MISSING_ENV_FILE']) */
  ignore?: string[];
  /** Target environment object to write variables to (defaults to process.env) */
  processEnv?: Record<string, string>;
  /** Path to .env.keys file for decryption keys (useful for monorepos) */
  envKeysFile?: string;
  /** DOTENV_KEY for decrypting .env.vault files */
  DOTENV_KEY?: string;
  /** Load specific convention (available: 'nextjs', 'flow') */
  convention?: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Enable quiet mode (error level only) */
  quiet?: boolean;
  /** Set specific log level */
  logLevel?: 'error' | 'warn' | 'success' | 'successv' | 'info' | 'help' | 'verbose' | 'debug';
}

interface DotenvConfigOutput {
  /** Error object if loading failed */
  error?: Error;
  /** Parsed key-value pairs from .env files */
  parsed?: Record<string, string>;
}
```

**Usage Examples:**

```javascript
const dotenvx = require('@dotenvx/dotenvx');

// Basic usage - load .env from current directory
const result = dotenvx.config();
console.log(result.parsed); // { API_KEY: 'secret', DB_URL: 'localhost' }

// Load from custom path
dotenvx.config({ path: '/path/to/.env.production' });

// Load multiple files with priority order
dotenvx.config({
  path: ['.env.local', '.env', '.env.defaults'],
});

// Override existing environment variables
dotenvx.config({ overload: true });

// Load with strict error handling
try {
  dotenvx.config({ strict: true });
} catch (error) {
  console.error('Failed to load .env:', error.message);
}

// Load into custom environment object
const customEnv = {};
dotenvx.config({ processEnv: customEnv });
console.log(customEnv); // Contains loaded variables

// Load encrypted .env.vault file
dotenvx.config({
  DOTENV_KEY:
    'dotenv://:key_1234...@dotenvx.com/vault/.env.vault?environment=production',
});

// Load with convention (automatically finds appropriate .env files)
dotenvx.config({ convention: 'nextjs' });

// Ignore specific errors (useful for optional .env files)
dotenvx.config({
  ignore: ['MISSING_ENV_FILE'],
  path: ['.env.local', '.env'], // .env.local might not exist
});
```

### Auto-Config Import

Convenience import that automatically calls config() when the module is required.

```javascript { .api }
// Auto-executes config() on import
require('@dotenvx/dotenvx/config');
```

**Usage Example:**

```javascript
// This automatically loads .env and injects into process.env
require('@dotenvx/dotenvx/config');

// Environment variables are now available
console.log(process.env.API_KEY);
```

### Multi-Environment Loading

dotenvx supports loading multiple .env files simultaneously with priority handling:

```javascript
// Load multiple files - later files override earlier ones
dotenvx.config({
  path: [
    '.env.defaults', // Lowest priority
    '.env', // Medium priority
    '.env.local', // Highest priority
  ],
});

// With convention support
dotenvx.config({ convention: 'nextjs' });
// Automatically loads: .env.local, .env.development.local, .env.development, .env
```

### Encrypted Environment Files

dotenvx can load encrypted .env.vault files using DOTENV_KEY:

```javascript
// Set DOTENV_KEY environment variable or pass directly
process.env.DOTENV_KEY =
  'dotenv://:key_abc123...@dotenvx.com/vault/.env.vault?environment=production';
dotenvx.config();

// Or pass directly
dotenvx.config({
  DOTENV_KEY:
    'dotenv://:key_abc123...@dotenvx.com/vault/.env.vault?environment=production',
});
```

### Error Handling

The config function provides detailed error information:

```javascript
const result = dotenvx.config({ path: '.env.missing' });

if (result.error) {
  console.error('Error code:', result.error.code);
  console.error('Error message:', result.error.message);
  if (result.error.help) {
    console.error('Help:', result.error.help);
  }
}
```

Common error codes:

- `MISSING_ENV_FILE`: .env file not found
- `PERMISSION_DENIED`: Cannot read .env file
- `INVALID_DOTENV_KEY`: Malformed DOTENV_KEY
- `DECRYPTION_FAILED`: Cannot decrypt .env.vault file
