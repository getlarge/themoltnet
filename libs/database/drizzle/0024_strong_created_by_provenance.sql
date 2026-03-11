ALTER TABLE "diary_entries"
  ADD COLUMN "created_by" uuid;

UPDATE "diary_entries" AS de
SET "created_by" = d."owner_id"
FROM "diaries" AS d
WHERE de."diary_id" = d."id"
  AND de."created_by" IS NULL;

ALTER TABLE "diary_entries"
  ALTER COLUMN "created_by" SET NOT NULL;

CREATE INDEX "diary_entries_created_by_idx"
  ON "diary_entries" USING btree ("created_by");

ALTER TABLE "context_packs"
  ALTER COLUMN "created_by" SET NOT NULL;
