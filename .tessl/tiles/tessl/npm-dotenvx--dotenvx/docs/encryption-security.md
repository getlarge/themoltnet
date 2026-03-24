# Encryption & Security

Encryption capabilities for securing sensitive environment variables using public/private key cryptography with automatic key management.

## Capabilities

### Keypair Function

Generates or retrieves public/private keypairs for encrypting and decrypting environment variables.

```javascript { .api }
/**
 * Generate or retrieve keypairs for encryption
 * @param envFile - Path to .env file to generate keys for
 * @param key - Specific keypair key to retrieve (optional)
 * @param envKeysFile - Path to .env.keys file (defaults to .env.keys)
 * @returns Object containing keypair data or specific key value
 */
function keypair(envFile?: string, key?: string, envKeysFile?: string): Record<string, any>;
```

**Usage Examples:**

```javascript
const dotenvx = require('@dotenvx/dotenvx');

// Generate keypair for default .env file
const keypairs = dotenvx.keypair();
console.log(keypairs);
// {
//   DOTENV_PRIVATE_KEY: 'a4547dcd9d3429615a3649bb79e87edb62ee6a74b007075e9141ae44f5fb412c',
//   DOTENV_PUBLIC_KEY: '02b4a4b6f5f6c4a4d3c2e1f0e9d8c7b6a5948372615a3649bb79e87edb62ee6a'
// }

// Generate keypair for specific .env file
const prodKeys = dotenvx.keypair('.env.production');

// Get specific key from keypair
const privateKey = dotenvx.keypair('.env', 'DOTENV_PRIVATE_KEY');
console.log(privateKey); // 'a4547dcd9d3429615a3649bb79e87edb62ee6a74b007075e9141ae44f5fb412c'

// Use custom .env.keys file location (useful for monorepos)
const keys = dotenvx.keypair('.env', null, '../../.env.keys');

// Generate multiple environment keypairs
const devKeys = dotenvx.keypair('.env.development');
const stagingKeys = dotenvx.keypair('.env.staging');
const prodKeys = dotenvx.keypair('.env.production');
```

### Automatic Encryption

When using the `set` function, values are encrypted by default:

```javascript
// This automatically encrypts the value
dotenvx.set('SECRET_API_KEY', 'very-secret-key');

// The .env file will contain something like:
// SECRET_API_KEY="encrypted:BE9Y7LKANx77X1pv1HnEoil93fPa5c9rpL/..."

// The .env.keys file will contain the decryption key:
// DOTENV_PRIVATE_KEY="a4547dcd9d3429615a3649bb79e87edb62ee6a74b007075e9141ae44f5fb412c"
```

### Manual Encryption/Decryption

You can use the keypair system for manual encryption workflows:

```javascript
// Generate keypair for encryption
const keys = dotenvx.keypair('.env.secrets');
const privateKey = keys.DOTENV_PRIVATE_KEY;
const publicKey = keys.DOTENV_PUBLIC_KEY;

// Set encrypted value using the keypair
dotenvx.set('DATABASE_PASSWORD', 'super-secret-password', {
  path: '.env.secrets',
});

// The private key is automatically stored in .env.keys for decryption
// When loading, dotenvx will automatically decrypt using the stored key
```

### Environment-Specific Encryption

Different environments can have separate encryption keys:

```javascript
// Development environment
const devKeys = dotenvx.keypair('.env.development');
dotenvx.set('DEV_SECRET', 'dev-secret', { path: '.env.development' });

// Production environment
const prodKeys = dotenvx.keypair('.env.production');
dotenvx.set('PROD_SECRET', 'prod-secret', { path: '.env.production' });

// Each environment gets its own key in .env.keys:
// DOTENV_PRIVATE_KEY_DEVELOPMENT="dev-private-key"
// DOTENV_PRIVATE_KEY_PRODUCTION="prod-private-key"
```

### Working with .env.keys Files

The .env.keys file stores private keys for decryption:

```javascript
// Default .env.keys location
const keys = dotenvx.keypair(); // Uses ./.env.keys

// Custom .env.keys location (useful for monorepos)
const keys = dotenvx.keypair('.env', null, '../../shared/.env.keys');

// Multiple applications can share a .env.keys file
dotenvx.keypair('.env.app1', null, '../shared/.env.keys');
dotenvx.keypair('.env.app2', null, '../shared/.env.keys');
```

### Security Best Practices

```javascript
// 1. Keep .env.keys files secure and out of version control
// Add to .gitignore:
// .env.keys
// .env.keys.*

// 2. Use environment-specific keypairs
const prodKeys = dotenvx.keypair('.env.production');
const devKeys = dotenvx.keypair('.env.development');

// 3. Encrypt sensitive values only, keep public values plain
dotenvx.set('SECRET_TOKEN', 'secret', { encrypt: true }); // Encrypted
dotenvx.set('PUBLIC_API_URL', 'https://api.com', { encrypt: false }); // Plain

// 4. Use custom .env.keys locations for monorepos
dotenvx.set('SHARED_SECRET', 'secret', {
  envKeysFile: '../../.env.keys',
});
```

### Encryption in CI/CD

For deployment environments, provide the private key as an environment variable:

```bash
# In CI/CD environment, set the private key
export DOTENV_PRIVATE_KEY="a4547dcd9d3429615a3649bb79e87edb62ee6a74b007075e9141ae44f5fb412c"

# Or for specific environments
export DOTENV_PRIVATE_KEY_PRODUCTION="prod-private-key"
```

```javascript
// dotenvx will automatically use the environment variable for decryption
dotenvx.config(); // Automatically decrypts using DOTENV_PRIVATE_KEY

// Or specify the key directly
dotenvx.config({
  privateKey: process.env.DOTENV_PRIVATE_KEY_PRODUCTION,
});
```

### Key Rotation

Generate new keypairs for key rotation:

```javascript
// Generate new keypair (this will create new keys)
const newKeys = dotenvx.keypair('.env.production');

// Re-encrypt existing variables with new keys
// This is typically done through the CLI: dotenvx rotate
```

### Vault File Support

dotenvx also supports encrypted .env.vault files with DOTENV_KEY:

```javascript
// Load encrypted vault file
dotenvx.config({
  DOTENV_KEY:
    'dotenv://:key_1234...@dotenvx.com/vault/.env.vault?environment=production',
});

// DOTENV_KEY contains both the decryption key and vault location
// This is different from the local keypair system
```

### Error Handling

Handle encryption-related errors:

```javascript
try {
  const result = dotenvx.config();
  if (result.error && result.error.code === 'DECRYPTION_FAILED') {
    console.error('Cannot decrypt .env file - check private key');
  }
} catch (error) {
  if (error.message.includes('private key')) {
    console.error('Missing or invalid private key for decryption');
  }
}
```
