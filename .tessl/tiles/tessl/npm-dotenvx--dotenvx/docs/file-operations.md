# File Operations

Utilities for discovering, listing, and managing .env files across projects with support for generating example files and managing project structure.

## Capabilities

### List Files Function

Lists all .env files in a directory using a tree structure, with support for glob patterns and exclusions.

```javascript { .api }
/**
 * List all .env files in a directory tree structure
 * @param directory - Directory to search (defaults to current directory)
 * @param envFile - Glob pattern(s) to match env files
 * @param excludeEnvFile - Glob pattern(s) to exclude from results
 * @returns Array of file paths matching the criteria
 */
function ls(
  directory?: string,
  envFile?: string | string[],
  excludeEnvFile?: string | string[]
): string[];
```

**Usage Examples:**

```javascript
const dotenvx = require('@dotenvx/dotenvx');

// List all .env* files in current directory
const files = dotenvx.ls();
console.log(files);
// ['.env', '.env.local', '.env.example', 'config/.env.production']

// List from specific directory
const prodFiles = dotenvx.ls('./config');

// List with custom pattern
const customFiles = dotenvx.ls('.', '*.environment');
// Finds: dev.environment, prod.environment, etc.

// List with multiple patterns
const multiFiles = dotenvx.ls('.', ['.env*', '*.config']);

// List with exclusions
const filtered = dotenvx.ls('.', '.env*', '.env.example');
// Excludes .env.example from results

// List with multiple exclusions
const filtered2 = dotenvx.ls('.', '.env*', ['.env.example', '*.backup']);
```

### Generate Example Function

Generates a .env.example file from existing .env files, removing sensitive values while preserving structure and keys.

```javascript { .api }
/**
 * Generate .env.example file from existing .env files
 * @param directory - Working directory (defaults to current directory)
 * @param envFile - Path to source .env file(s)
 * @returns Object containing generation results and metadata
 */
function genexample(directory?: string, envFile?: string): GenExampleOutput;

interface GenExampleOutput {
  /** Name of the generated example file */
  envExampleFile: string;
  /** Source .env file(s) used for generation */
  envFile: string | string[];
  /** Full path to the generated example file */
  exampleFilepath: string;
  /** Array of keys that were added to the example file */
  addedKeys: string[];
  /** Object containing the variables that were processed */
  injected: Record<string, string>;
  /** Object containing variables that already existed */
  preExisted: Record<string, string>;
}
```

**Usage Examples:**

```javascript
const dotenvx = require('@dotenvx/dotenvx');

// Generate .env.example from .env in current directory
const result = dotenvx.genexample();
console.log(result.addedKeys); // ['API_KEY', 'DB_URL', 'SECRET_TOKEN']
console.log(result.exampleFilepath); // '.env.example'

// Generate from specific directory
const result2 = dotenvx.genexample('./config');

// Generate from specific .env file
const result3 = dotenvx.genexample('.', '.env.production');

// Handle generation results
const result = dotenvx.genexample();
if (result.addedKeys.length > 0) {
  console.log(`Generated .env.example with ${result.addedKeys.length} keys:`);
  result.addedKeys.forEach((key) => console.log(`  - ${key}`));
}

// Check what was injected vs pre-existed
console.log('New keys:', Object.keys(result.injected));
console.log('Existing keys:', Object.keys(result.preExisted));
```

### File Discovery Patterns

dotenvx supports flexible file discovery patterns:

```javascript
// Standard .env file patterns
dotenvx.ls('.', '.env*');
// Finds: .env, .env.local, .env.development, .env.production, etc.

// Custom naming conventions
dotenvx.ls('.', 'environment.*');
// Finds: environment.dev, environment.prod, etc.

// Multiple patterns
dotenvx.ls('.', ['.env*', 'config/*.env', '*.environment']);

// Complex exclusions
dotenvx.ls('.', '.env*', ['*.backup', '*.example', '*.template']);
```

### Directory Structure Examples

dotenvx handles various project structures:

```
project/
├── .env                    # Found by: dotenvx.ls()
├── .env.local             # Found by: dotenvx.ls()
├── .env.example          # Excluded by: dotenvx.ls('.', '.env*', '.env.example')
└── config/
    ├── .env.development  # Found by: dotenvx.ls('config')
    └── .env.production   # Found by: dotenvx.ls('config')
```

### Example File Generation Process

The genexample function processes .env files and creates safe example versions:

```javascript
// Original .env content:
// API_KEY=secret123
// DB_URL=postgres://user:pass@localhost:5432/db
// DEBUG=true
// PUBLIC_URL=https://example.com

const result = dotenvx.genexample();

// Generated .env.example content:
// API_KEY=
// DB_URL=
// DEBUG=true
// PUBLIC_URL=https://example.com

console.log(result.addedKeys); // ['API_KEY', 'DB_URL', 'DEBUG', 'PUBLIC_URL']
```

### Monorepo Support

dotenvx handles monorepo structures effectively:

```javascript
// List files across monorepo packages
const allFiles = dotenvx.ls('.', '.env*');
// Finds .env files in all subdirectories

// Generate examples for specific packages
dotenvx.genexample('./packages/frontend');
dotenvx.genexample('./packages/backend');

// Exclude package-specific files
const sharedFiles = dotenvx.ls('.', '.env*', 'packages/**/.env*');
// Only finds root-level .env files
```

### Integration with Other Functions

File operations integrate seamlessly with other dotenvx functions:

```javascript
// Discover files, then load them
const envFiles = dotenvx.ls();
dotenvx.config({ path: envFiles });

// Generate example, then set variables in the source
dotenvx.genexample();
dotenvx.set('NEW_VAR', 'value'); // Updates the source .env

// List files to understand structure before management
const files = dotenvx.ls();
console.log('Managing variables across:', files);
files.forEach((file) => {
  const value = dotenvx.get('SHARED_VAR', { path: file });
  console.log(`${file}: SHARED_VAR=${value}`);
});
```
