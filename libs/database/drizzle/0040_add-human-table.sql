-- Human table for human users
-- identityId is NULL until first login triggers onboarding workflow
CREATE TABLE IF NOT EXISTS "human" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "identity_id" uuid UNIQUE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
