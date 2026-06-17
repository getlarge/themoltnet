CREATE TABLE "runtime_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid,
	"provider" varchar(100) NOT NULL,
	"model" varchar(200) NOT NULL,
	"display_name" varchar(200),
	"description" text,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_human_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_models_creator_xor" CHECK (((team_id IS NULL) AND (created_by_agent_id IS NULL) AND (created_by_human_id IS NULL)) OR ((team_id IS NOT NULL) AND ((created_by_agent_id IS NOT NULL) <> (created_by_human_id IS NOT NULL))))
);
--> statement-breakpoint
ALTER TABLE "runtime_models" ADD CONSTRAINT "runtime_models_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_models" ADD CONSTRAINT "runtime_models_created_by_agent_id_agents_identity_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("identity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_models" ADD CONSTRAINT "runtime_models_created_by_human_id_humans_id_fk" FOREIGN KEY ("created_by_human_id") REFERENCES "public"."humans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_models_global_uq" ON "runtime_models" USING btree ("provider","model") WHERE team_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_models_team_uq" ON "runtime_models" USING btree ("team_id","provider","model") WHERE team_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "runtime_models_team_idx" ON "runtime_models" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "runtime_models_provider_idx" ON "runtime_models" USING btree ("provider");--> statement-breakpoint
-- Seed MoltNet's global runtime-models catalog. These are the provider/model
-- couples MoltNet supports out of the box, derived from
-- libs/dspy-adapters/provider.go and operational examples in
-- docs/use/agent-daemon.md and docs/reference/quick-reference.md. Idempotent
-- via the partial unique index `runtime_models_global_uq`. To re-seed or
-- expand: append new rows; never mutate existing rows here (operators update
-- via the catalog API or a follow-up migration).
INSERT INTO "runtime_models" ("team_id", "provider", "model", "display_name", "description", "capabilities", "is_active")
VALUES
  (NULL, 'anthropic', 'claude-sonnet-4-5', 'Anthropic · Claude Sonnet 4.5', 'Balanced Anthropic model for Sonnet 4.5 generation.', '{"supportsTools": true, "supportsVision": true, "contextWindow": 200000}', true),
  (NULL, 'anthropic', 'claude-opus-4-5', 'Anthropic · Claude Opus 4.5', 'Top-of-line Anthropic model for Opus 4.5 generation.', '{"supportsTools": true, "supportsVision": true, "contextWindow": 200000}', true),
  (NULL, 'anthropic', 'claude-haiku-4-5', 'Anthropic · Claude Haiku 4.5', 'Low-latency Anthropic model for Haiku 4.5 generation.', '{"supportsTools": true, "supportsVision": true, "contextWindow": 200000}', true),
  (NULL, 'openai', 'gpt-5.1', 'OpenAI · GPT-5.1', 'OpenAI GPT-5.1 generation.', '{"supportsTools": true, "supportsVision": true, "contextWindow": 128000}', true),
  (NULL, 'openai', 'gpt-5.4', 'OpenAI · GPT-5.4', 'OpenAI GPT-5.4 generation.', '{"supportsTools": true, "supportsVision": true, "contextWindow": 128000}', true),
  (NULL, 'openai', 'gpt-4o-mini', 'OpenAI · GPT-4o mini', 'Lightweight OpenAI model.', '{"supportsTools": true, "supportsVision": true, "contextWindow": 128000}', true),
  (NULL, 'openai-codex', 'gpt-5.1-codex', 'OpenAI · GPT-5.1 Codex', 'Code-tuned OpenAI GPT-5.1 variant.', '{"supportsTools": true, "contextWindow": 128000}', true),
  (NULL, 'openai-codex', 'gpt-5.4-codex', 'OpenAI · GPT-5.4 Codex', 'Code-tuned OpenAI GPT-5.4 variant.', '{"supportsTools": true, "contextWindow": 128000}', true),
  (NULL, 'ollama', 'llama3.3', 'Ollama · Llama 3.3', 'Local Ollama model.', '{"supportsTools": false, "contextWindow": 128000}', true),
  (NULL, 'ollama', 'qwen2.5-coder', 'Ollama · Qwen 2.5 Coder', 'Local Ollama code model.', '{"supportsTools": false, "contextWindow": 32000}', true),
  (NULL, 'ollama-cloud', 'llama3.3', 'Ollama Cloud · Llama 3.3', 'Ollama Cloud-hosted Llama 3.3.', '{"supportsTools": false, "contextWindow": 128000}', true),
  (NULL, 'claude-code', 'claude-sonnet-4-5', 'Claude Code · Sonnet 4.5', 'Claude Code runtime against Anthropic Sonnet 4.5.', '{"supportsTools": true, "contextWindow": 200000}', true),
  (NULL, 'bedrock', 'claude-sonnet-4-5', 'AWS Bedrock · Claude Sonnet 4.5', 'Anthropic Sonnet 4.5 routed through AWS Bedrock.', '{"supportsTools": true, "contextWindow": 200000}', true)
ON CONFLICT ("provider", "model") WHERE "team_id" IS NULL DO NOTHING;