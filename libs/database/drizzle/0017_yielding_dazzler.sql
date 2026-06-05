ALTER TABLE "tasks" ADD COLUMN "title" varchar(255);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "tasks_tags_gin_idx" ON "tasks" USING gin ("tags");