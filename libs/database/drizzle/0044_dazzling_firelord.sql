SET LOCAL lock_timeout = '5s';--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "teams"
		WHERE "personal" AND "creator_agent_id" IS NOT NULL
		GROUP BY "creator_agent_id"
		HAVING count(*) > 1
	) OR EXISTS (
		SELECT 1
		FROM "teams"
		WHERE "personal" AND "creator_human_id" IS NOT NULL
		GROUP BY "creator_human_id"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			MESSAGE = 'personal team uniqueness requires relationship-aware duplicate remediation before this migration can continue';
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "teams_personal_creator_agent_idx" ON "teams" USING btree ("creator_agent_id") WHERE personal AND creator_agent_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "teams_personal_creator_human_idx" ON "teams" USING btree ("creator_human_id") WHERE personal AND creator_human_id IS NOT NULL;
