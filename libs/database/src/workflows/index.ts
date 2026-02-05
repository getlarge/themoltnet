/**
 * DBOS Durable Workflows
 *
 * Re-exports all workflow definitions for use in the application.
 *
 * ## Initialization Order
 *
 * 1. configureDBOS()        — set DBOS config
 * 2. initKetoWorkflows()    — register workflows
 * 3. setKetoRelationshipWriter() — inject Keto client
 * 4. initDBOS()             — create data source
 * 5. launchDBOS()           — start runtime
 */

export {
  initKetoWorkflows,
  type KetoRelationshipWriter,
  ketoWorkflows,
  setKetoRelationshipWriter,
} from './keto-workflows.js';
