# Programmatic API

The lint-staged programmatic API allows you to integrate lint-staged functionality directly into Node.js applications, custom tooling, and build systems.

## Main Function

```javascript { .api }
function lintStaged(options?: Options, logger?: Logger): Promise<boolean>;
```

**Parameters:**

- `options` (Options, optional): Configuration options for execution
- `logger` (Logger, optional): Custom logger object, defaults to `console`

**Returns:** `Promise<boolean>` - `true` when all tasks succeed, `false` when some tasks fail

**Throws:** `Error` when configuration issues or other fatal errors occur

## Options

```javascript { .api }
interface Options {
  allowEmpty?: boolean;
  concurrent?: boolean | number;
  config?: Configuration;
  configPath?: string;
  cwd?: string;
  debug?: boolean;
  diff?: string;
  diffFilter?: string;
  maxArgLength?: number;
  quiet?: boolean;
  relative?: boolean;
  shell?: boolean | string;
  stash?: boolean;
  hidePartiallyStaged?: boolean;
  verbose?: boolean;
}
```

### Option Details

**`allowEmpty`** (boolean, default: false)

- Allow empty commits when tasks revert all staged changes
- Useful when formatters might remove all changes

**`concurrent`** (boolean | number, default: true)

- Control task concurrency
- `true`: Run tasks concurrently (default)
- `false`: Run tasks serially
- `number`: Maximum number of concurrent tasks

**`config`** (Configuration)

- Manual task configuration object
- Disables automatic config file discovery when used
- See Configuration section for format details

**`configPath`** (string)

- Path to single configuration file
- Disables automatic config file discovery when used
- Use "-" to read from stdin

**`cwd`** (string)

- Working directory to run all tasks in
- Defaults to current working directory

**`debug`** (boolean, default: false)

- Enable debug output
- Shows detailed execution information

**`diff`** (string)

- Override the default `--staged` flag of `git diff`
- Example: `"HEAD...origin/main"`
- **Warning:** Changing this implies `stash: false`

**`diffFilter`** (string, default: "ACMR")

- Override the default `--diff-filter=ACMR` flag
- Controls which types of file changes to include

**`maxArgLength`** (number)

- Maximum argument string length
- Automatically detected by default based on platform

**`quiet`** (boolean, default: false)

- Disable lint-staged's own console output
- Only errors will be shown

**`relative`** (boolean, default: false)

- Pass filepaths relative to `cwd` to tasks
- By default, absolute paths are used

**`shell`** (boolean | string, default: false)

- Skip parsing of tasks for better shell support
- `true`: Use default shell
- `string`: Use specific shell path

**`stash`** (boolean, default: true)

- Enable the backup stash and revert in case of errors
- **Warning:** Disabling this implies `hidePartiallyStaged: false`

**`hidePartiallyStaged`** (boolean, default: true)

- Hide unstaged changes from partially staged files before running tasks
- Helps ensure tasks only see intended changes

**`verbose`** (boolean, default: false)

- Show task output even when tasks succeed
- By default, only failed output is shown

## Configuration

```javascript { .api }
type Configuration =
  | Record<string, string | FunctionTask | (string | FunctionTask)[]>
  | FunctionTask;

type SyncFunctionTask = (stagedFileNames: string[]) => string | string[];
type AsyncFunctionTask = (stagedFileNames: string[]) => Promise<string | string[]>;
type FunctionTask = SyncFunctionTask | AsyncFunctionTask;
```

### Configuration Examples

**Object Configuration:**

```javascript
const config = {
  '*.js': 'eslint --fix',
  '*.{json,md}': ['prettier --write', 'git add'],
  '*.css': async (filenames) => {
    return `stylelint ${filenames.join(' ')} --fix`;
  },
};
```

**Function Configuration:**

```javascript
const config = (filenames) => {
  return filenames.map((filename) => `echo "Processing ${filename}"`);
};
```

## Logger Interface

```javascript { .api }
interface Logger {
  log: (...params: any) => void;
  warn: (...params: any) => void;
  error: (...params: any) => void;
}
```

Custom logger example:

```javascript
const customLogger = {
  log: (message) => console.log(`[INFO] ${message}`),
  warn: (message) => console.warn(`[WARN] ${message}`),
  error: (message) => console.error(`[ERROR] ${message}`),
};

await lintStaged(options, customLogger);
```

## Usage Examples

### Basic Usage

```javascript
import lintStaged from 'lint-staged';

// Simple usage with configuration object
const success = await lintStaged({
  config: {
    '*.js': 'eslint --fix',
    '*.json': 'prettier --write',
  },
});

if (!success) {
  process.exit(1);
}
```

### Advanced Usage

```javascript
import lintStaged from 'lint-staged';

// Advanced configuration with custom options
const success = await lintStaged(
  {
    config: {
      '*.{js,ts}': ['eslint --fix', 'prettier --write'],
      '*.css': 'stylelint --fix',
      '*.md': (filenames) => `markdownlint ${filenames.join(' ')}`,
    },
    concurrent: 3,
    verbose: true,
    allowEmpty: true,
    cwd: '/path/to/project',
  },
  {
    log: (msg) => console.log(`✓ ${msg}`),
    warn: (msg) => console.warn(`⚠ ${msg}`),
    error: (msg) => console.error(`✗ ${msg}`),
  },
);
```

### Integration with Build Tools

```javascript
import lintStaged from 'lint-staged';

// Example integration in a build script
export async function prebuild() {
  console.log('Running lint-staged...');

  const passed = await lintStaged({
    configPath: './lint-staged.config.js',
    quiet: true,
  });

  if (!passed) {
    throw new Error('lint-staged failed - fix issues before building');
  }

  console.log('All checks passed!');
}
```

### Error Handling

```javascript
import lintStaged from 'lint-staged';

try {
  const success = await lintStaged({
    config: { '*.js': 'eslint --fix' },
  });

  if (success) {
    console.log('All tasks completed successfully');
  } else {
    console.log('Some tasks failed');
    process.exit(1);
  }
} catch (error) {
  console.error('Fatal error:', error.message);
  process.exit(1);
}
```
