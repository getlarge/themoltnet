# Logging & Utilities

Shared utilities for logging, formatting, and configuration that are exposed for use by extensions and advanced integrations.

## Capabilities

### Log Level Management

Configure the logging behavior of dotenvx operations.

```javascript { .api }
/**
 * Configure the global log level for dotenvx operations
 * @param options - Logging configuration options
 */
function setLogLevel(options: {
  /** Specific log level to set */
  logLevel?: 'error' | 'warn' | 'success' | 'successv' | 'info' | 'help' | 'verbose' | 'debug';
  /** Enable debug mode (sets level to debug) */
  debug?: boolean;
  /** Enable verbose mode (sets level to verbose) */
  verbose?: boolean;
  /** Enable quiet mode (sets level to error only) */
  quiet?: boolean;
}): void;
```

**Usage Examples:**

```javascript
const { setLogLevel } = require('@dotenvx/dotenvx');

// Set specific log level
setLogLevel({ logLevel: 'verbose' });

// Enable debug mode
setLogLevel({ debug: true });

// Enable quiet mode (errors only)
setLogLevel({ quiet: true });

// Enable verbose mode
setLogLevel({ verbose: true });

// Multiple options (debug takes precedence)
setLogLevel({ debug: true, quiet: true }); // Results in debug level
```

### Logger Interface

Access to the internal logging system used by dotenvx.

```javascript { .api }
/**
 * Logger instance with methods for different log levels
 */
const logger: {
  /** Log error messages (always visible) */
  error(message: string): void;
  /** Log warning messages */
  warn(message: string): void;
  /** Log success messages */
  success(message: string): void;
  /** Log success messages (verbose variant) */
  successv(message: string): void;
  /** Log informational messages */
  info(message: string): void;
  /** Log help/guidance messages */
  help(message: string): void;
  /** Log verbose messages (only visible in verbose mode) */
  verbose(message: string): void;
  /** Log debug messages (only visible in debug mode) */
  debug(message: string): void;
};
```

**Usage Examples:**

```javascript
const { logger } = require('@dotenvx/dotenvx');

// Different log levels
logger.error('Something went wrong!');
logger.warn('This is a warning');
logger.success('Operation completed successfully');
logger.info('Loading configuration...');
logger.help('Try using --help for more options');
logger.verbose('Detailed operation info');
logger.debug('Internal state: { loaded: true }');

// Practical usage in applications
function loadConfig() {
  logger.verbose('Starting configuration load...');

  try {
    const result = dotenvx.config();
    if (result.error) {
      logger.error(`Failed to load config: ${result.error.message}`);
      return false;
    }

    logger.success('Configuration loaded successfully');
    logger.debug(`Loaded keys: ${Object.keys(result.parsed || {}).join(', ')}`);
    return true;
  } catch (error) {
    logger.error(`Unexpected error: ${error.message}`);
    return false;
  }
}
```

### Text Formatting Utilities

Color and formatting functions for consistent output styling.

```javascript { .api }
/**
 * Get a color formatting function
 * @param name - Color name
 * @returns Function that applies the color to text
 */
function getColor(name: string): (text: string) => string;

/**
 * Apply bold formatting to text
 * @param text - Text to make bold
 * @returns Bold-formatted text
 */
function bold(text: string): string;
```

**Usage Examples:**

```javascript
const { getColor, bold } = require('@dotenvx/dotenvx');

// Get color functions
const red = getColor('red');
const green = getColor('green');
const blue = getColor('blue');
const yellow = getColor('yellow');

// Apply colors
console.log(red('Error: Something failed'));
console.log(green('Success: Operation completed'));
console.log(blue('Info: Loading configuration'));
console.log(yellow('Warning: Deprecated option used'));

// Apply bold formatting
console.log(bold('Important Notice'));
console.log(green(bold('SUCCESS: All tests passed!')));

// Combine formatting
const redBold = (text) => red(bold(text));
console.log(redBold('CRITICAL ERROR'));

// Available colors (common ones)
const colors = {
  red: getColor('red'),
  green: getColor('green'),
  blue: getColor('blue'),
  yellow: getColor('yellow'),
  cyan: getColor('cyan'),
  magenta: getColor('magenta'),
  white: getColor('white'),
  gray: getColor('gray'),
};

// Usage in applications
function reportStatus(success, message) {
  if (success) {
    console.log(colors.green(bold('✓')) + ' ' + message);
  } else {
    console.log(colors.red(bold('✗')) + ' ' + message);
  }
}
```

### Integration with dotenvx Operations

The logging utilities integrate seamlessly with dotenvx operations:

```javascript
const { config, setLogLevel, logger } = require('@dotenvx/dotenvx');

// Configure logging before operations
setLogLevel({ verbose: true });

// All dotenvx operations will use the configured log level
const result = config(); // Will show verbose output

// Use logger for custom application logging that matches dotenvx style
logger.info('Starting application...');
logger.verbose('Loading additional configuration...');

if (result.error) {
  logger.error('Configuration failed to load');
  logger.help('Check that your .env file exists and is readable');
} else {
  logger.success('Application configuration loaded');
}
```

### Advanced Logging Patterns

```javascript
const { logger, setLogLevel, getColor } = require('@dotenvx/dotenvx');

// Dynamic log level based on environment
const logLevel = process.env.NODE_ENV === 'development' ? 'debug' : 'info';
setLogLevel({ logLevel });

// Structured logging with colors
const cyan = getColor('cyan');
const gray = getColor('gray');

function logOperation(operation, details) {
  logger.info(cyan(operation));
  if (details) {
    logger.verbose(gray(`  ${details}`));
  }
}

// Usage
logOperation('Loading configuration', 'from .env.production');
logOperation('Setting environment variable', 'API_KEY (encrypted)');

// Error handling with helpful messages
function handleConfigError(error) {
  logger.error(`Configuration error: ${error.message}`);

  if (error.code === 'MISSING_ENV_FILE') {
    logger.help('Create a .env file with your environment variables');
    logger.help('Example: echo "API_KEY=your-key" > .env');
  } else if (error.code === 'PERMISSION_DENIED') {
    logger.help('Check file permissions on your .env file');
    logger.help('Fix: chmod 644 .env');
  }
}
```

### Log Level Hierarchy

The logging system follows this hierarchy (from least to most verbose):

1. **error**: Only critical errors
2. **warn**: Warnings and errors
3. **success**: Success messages, warnings, and errors
4. **successv**: Verbose success messages and above
5. **info**: Informational messages and above (default)
6. **help**: Help messages and above
7. **verbose**: Detailed operation info and above
8. **debug**: All messages including internal debug info

```javascript
// Set different levels to see different amounts of output
setLogLevel({ logLevel: 'error' }); // Minimal output
setLogLevel({ logLevel: 'info' }); // Standard output (default)
setLogLevel({ logLevel: 'verbose' }); // Detailed output
setLogLevel({ logLevel: 'debug' }); // Maximum output
```

### Extension Development

These utilities are particularly useful when developing extensions for dotenvx:

```javascript
const { logger, getColor, bold } = require('@dotenvx/dotenvx');

// Extension-specific logging
const extensionName = 'my-extension';
const prefix = getColor('magenta')(`[${extensionName}]`);

function extensionLog(level, message) {
  logger[level](`${prefix} ${message}`);
}

// Usage in extension
extensionLog('info', 'Extension initialized');
extensionLog('verbose', 'Processing configuration options');
extensionLog('success', bold('Extension operation completed'));
```
