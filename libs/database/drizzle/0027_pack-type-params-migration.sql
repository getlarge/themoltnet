-- Migration: Replace typed compile columns with packType enum + params JSONB
-- Context: No production data exists in context_packs (table created in #397,
-- never populated). This is a clean schema change, not a backfill.
--
-- All compile-specific columns (tokenBudget, lambda, taskPromptHash, wRecency,
-- wImportance) move into the params JSONB. Their shape is determined by packType
-- and validated at the service layer.

-- Step 1: Create pack_type enum
CREATE TYPE "public"."pack_type" AS ENUM('compile', 'optimized', 'custom');

-- Step 2: Add new columns
ALTER TABLE "context_packs"
  ADD COLUMN "pack_type" "pack_type" NOT NULL DEFAULT 'compile',
  ADD COLUMN "params" jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Step 3: Drop old typed columns (no data to migrate)
ALTER TABLE "context_packs"
  DROP COLUMN IF EXISTS "task_prompt_hash",
  DROP COLUMN IF EXISTS "token_budget",
  DROP COLUMN IF EXISTS "lambda",
  DROP COLUMN IF EXISTS "w_recency",
  DROP COLUMN IF EXISTS "w_importance";

-- Step 4: Add index on pack_type for filtered queries
CREATE INDEX IF NOT EXISTS "context_packs_pack_type_idx"
  ON "context_packs" ("pack_type");
