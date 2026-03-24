# Environment Management

Functions for reading, writing, and managing environment variables in .env files with support for encryption and multiple file formats.

## Capabilities

### Parse Function

Parses a string or buffer in the .env file format into an object, with support for encrypted values.

```javascript { .api }
/**
 * Parses a string or buffer in the .env file format into an object
 * @param src - Contents to be parsed (e.g., 'DB_HOST=localhost')
 * @param options - Additional parsing options
 * @returns Object with keys and values based on src
 */
function parse(src: string | Buffer, options?: DotenvParseOptions): Record<string, string>;

interface DotenvParseOptions {
  /** Override existing values in processEnv when parsing */
  overload?: boolean;
  /** Alias for overload */
  override?: boolean;
  /** Environment object to read existing values from (defaults to process.env) */
  processEnv?: Record<string, string>;
  /** Private key for decrypting encrypted values */
  privateKey?: string;
}
```

**Usage Examples:**

```javascript
const dotenvx = require('@dotenvx/dotenvx');

// Basic parsing
const parsed = dotenvx.parse('API_KEY=secret123\nDB_URL=localhost:5432');
console.log(parsed); // { API_KEY: 'secret123', DB_URL: 'localhost:5432' }

// Parse with custom environment context
const customEnv = { EXISTING_VAR: 'existing' };
const parsed = dotenvx.parse('NEW_VAR=new', { processEnv: customEnv });

// Parse encrypted content with private key
const encryptedContent =
  'SECRET="encrypted:BE9Y7LKANx77X1pv1HnEoil93fPa5c9rpL..."';
const parsed = dotenvx.parse(encryptedContent, {
  privateKey:
    'a4547dcd9d3429615a3649bb79e87edb62ee6a74b007075e9141ae44f5fb412c',
});

// Parse from buffer
const buffer = Buffer.from('KEY=value\nANOTHER=test');
const parsed = dotenvx.parse(buffer);
```

### Set Function

Sets a single environment variable in .env files with optional encryption.

```javascript { .api }
/**
 * Set a single environment variable in .env files
 * @param key - Environment variable key
 * @param value - Environment variable value
 * @param options - Additional options for setting behavior
 * @returns Object containing processing results and affected files
 */
function set(key: string, value: string, options?: SetOptions): SetOutput;

interface SetOptions {
  /** Custom path(s) to .env file(s) where variable should be set */
  path?: string | string[] | URL;
  /** Path to .env.keys file for encryption keys */
  envKeysFile?: string;
  /** Set a .env convention (available: 'nextjs', 'flow') */
  convention?: string;
  /** Whether to encrypt the value (default: true) */
  encrypt?: boolean;
  /** Force plain text (overrides encrypt: true) */
  plain?: boolean;
}

interface SetOutput {
  /** Array of processed environment file data */
  processedEnvs: SetProcessedEnv[];
  /** Paths of files that were changed */
  changedFilepaths: string[];
  /** Paths of files that had no changes */
  unchangedFilepaths: string[];
}

interface SetProcessedEnv {
  /** The environment variable key */
  key: string;
  /** The environment variable value */
  value: string;
  /** Full path to the processed file */
  filepath: string;
  /** Relative path to the env file */
  envFilepath: string;
  /** Complete content of the env file after processing */
  envSrc: string;
  /** Whether the file was changed */
  changed: boolean;
  /** Encrypted version of the value (if encryption was used) */
  encryptedValue?: string;
  /** Public key used for encryption */
  publicKey?: string;
  /** Private key generated for decryption */
  privateKey?: string;
  /** Whether a new private key was added to .env.keys */
  privateKeyAdded?: boolean;
  /** Name of the private key in .env.keys */
  privateKeyName?: string;
  /** Error encountered during processing */
  error?: Error;
}
```

**Usage Examples:**

```javascript
const dotenvx = require('@dotenvx/dotenvx');

// Basic set (encrypted by default)
const result = dotenvx.set('API_KEY', 'secret123');
console.log(result.changedFilepaths); // ['.env']

// Set in specific file
dotenvx.set('DB_URL', 'localhost:5432', {
  path: '.env.production',
});

// Set in multiple files
dotenvx.set('SHARED_SECRET', 'secret', {
  path: ['.env.development', '.env.staging', '.env.production'],
});

// Set as plain text (no encryption)
dotenvx.set('PUBLIC_API_URL', 'https://api.example.com', {
  encrypt: false,
});

// Set with custom .env.keys file location
dotenvx.set('SECRET_TOKEN', 'token123', {
  envKeysFile: '../../.env.keys',
});

// Set with convention
dotenvx.set('NEXT_PUBLIC_API_URL', 'https://api.example.com', {
  convention: 'nextjs',
});

// Handle results
const result = dotenvx.set('NEW_VAR', 'value');
result.processedEnvs.forEach((env) => {
  if (env.error) {
    console.error(`Error processing ${env.envFilepath}:`, env.error.message);
  } else if (env.privateKeyAdded) {
    console.log(`New encryption key added: ${env.privateKeyName}`);
  }
});
```

### Get Function

Retrieves environment variable values from .env files with support for multiple formats and all-variables retrieval.

```javascript { .api }
/**
 * Get environment variable(s) from .env files
 * @param key - Environment variable key (optional - returns all if omitted)
 * @param options - Additional options for retrieval behavior
 * @returns String value for single key, object for all keys, formatted string for special formats
 */
function get(key?: string, options?: GetOptions): string | Record<string, string> | undefined;

interface GetOptions {
  /** Suppress specific error codes */
  ignore?: string[];
  /** Override existing environment variables with .env file values */
  overload?: boolean;
  /** Path to .env.keys file for decryption */
  envKeysFile?: string;
  /** Throw immediately if an error is encountered */
  strict?: boolean;
  /** Return all variables (when no key specified) */
  all?: boolean;
  /** Output format for all variables: 'eval' or 'shell' */
  format?: 'eval' | 'shell';
}
```

**Usage Examples:**

```javascript
const dotenvx = require('@dotenvx/dotenvx');

// Get single variable
const apiKey = dotenvx.get('API_KEY');
console.log(apiKey); // 'secret123'

// Get all variables as object
const allVars = dotenvx.get();
console.log(allVars); // { API_KEY: 'secret123', DB_URL: 'localhost', ... }

// Get all variables in eval format
const evalFormat = dotenvx.get(undefined, { format: 'eval' });
console.log(evalFormat);
// Output: API_KEY=secret123
//         DB_URL=localhost

// Get all variables in shell format
const shellFormat = dotenvx.get(undefined, { format: 'shell' });
console.log(shellFormat); // API_KEY=secret123 DB_URL=localhost

// Get with overload (prioritize .env over process.env)
const value = dotenvx.get('CONFLICTING_VAR', { overload: true });

// Get with custom .env.keys file
const secret = dotenvx.get('ENCRYPTED_SECRET', {
  envKeysFile: '../../.env.keys',
});

// Get with error handling
try {
  const value = dotenvx.get('REQUIRED_VAR', { strict: true });
} catch (error) {
  console.error('Variable not found:', error.message);
}

// Get with ignored errors
const value = dotenvx.get('OPTIONAL_VAR', {
  ignore: ['MISSING_ENV_FILE'],
});

// Handle undefined return
const maybeValue = dotenvx.get('MAYBE_MISSING');
if (maybeValue === undefined) {
  console.log('Variable not found');
} else {
  console.log('Value:', maybeValue);
}
```

### Multi-File Variable Management

dotenvx can manage variables across multiple .env files:

```javascript
// Set the same variable in multiple environments
dotenvx.set('FEATURE_FLAG', 'enabled', {
  path: ['.env.development', '.env.staging'],
});

// Get variables with file priority
const result = dotenvx.config({
  path: ['.env', '.env.local'], // .env.local takes priority
});
const value = dotenvx.get('SOME_VAR'); // Gets value from highest priority file
```

### Encrypted Variable Handling

dotenvx automatically handles encryption and decryption:

```javascript
// Setting an encrypted variable (default behavior)
dotenvx.set('SECRET_KEY', 'super-secret');
// This creates an encrypted value in .env and adds decryption key to .env.keys

// Getting an encrypted variable (automatic decryption)
const secret = dotenvx.get('SECRET_KEY');
// Returns the decrypted plain text value

// Force plain text storage
dotenvx.set('PUBLIC_CONFIG', 'not-secret', { encrypt: false });
```
