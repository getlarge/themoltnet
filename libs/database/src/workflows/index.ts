/**
 * DBOS Durable Workflows
 *
 * Re-exports all workflow definitions for use in the application.
 *
 * ## Initialization Order
 *
 * 1. configureDBOS()                    — set DBOS config
 * 2. initSigningWorkflows()            — register signing workflows
 * 3. setSigningVerifier/KeyLookup()    — inject signing deps
 * 4. initDBOS()                        — create data source
 * 5. launchDBOS()                      — start runtime
 * 6. setSigningRequestPersistence()    — inject persistence (needs dataSource)
 */

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
