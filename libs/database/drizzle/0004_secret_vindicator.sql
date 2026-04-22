CREATE INDEX "tasks_diary_idx" ON "tasks" USING btree ("diary_id") WHERE diary_id IS NOT NULL;
