CREATE INDEX "tasks_non_terminal_expires_idx" ON "tasks" USING btree ("expires_at") WHERE expires_at IS NOT NULL;
