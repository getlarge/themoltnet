/**
 * DBOS Durable Workflows
 *
 * Re-exports all workflow definitions for use in the application.
 *
 * ## Initialization Order
 *
 * 1. configureDBOS()                    — set DBOS config
 * 2. initKetoWorkflows()               — register Keto workflows
 * 3. initSigningWorkflows()            — register signing workflows
 * 4. setKetoRelationshipWriter()       — inject Keto client
 * 5. setSigningVerifier/KeyLookup()    — inject signing deps
 * 6. initDBOS()                        — create data source
 * 7. launchDBOS()                      — start runtime
 * 8. setSigningRequestPersistence()    — inject persistence (needs dataSource)
 */

export {
  initKetoWorkflows,
  type KetoRelationshipWriter,
  ketoWorkflows,
  setKetoRelationshipWriter,
} from './keto-workflows.js';
export {
  initRegistrationWorkflows,
  type RegistrationError,
  type RegistrationInput,
  type RegistrationResult,
  registrationWorkflows,
  setRegistrationDependencies,
} from './registration-workflows.js';
export {
  type AgentKeyLookup,
  initSigningWorkflows,
  setSigningKeyLookup,
  setSigningRequestPersistence,
  setSigningTimeoutSeconds,
  setSigningVerifier,
  type SignatureVerifier,
  type SigningEnvelope,
  type SigningRequestPersistence,
  type SigningResult,
  signingWorkflows,
} from './signing-workflows.js';
