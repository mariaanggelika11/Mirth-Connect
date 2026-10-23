-- Run inside the migrator transaction. Additive and repeatable; no session history is deleted.
DO $migration$
BEGIN
  IF EXISTS(SELECT 1 FROM "SchemaMigrations" WHERE version=8) THEN RETURN; END IF;
  CREATE TABLE IF NOT EXISTS "BrowserSessionFamilies" (
    family_id text PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES "Users"(id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamptz NOT NULL,
    last_activity_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at timestamptz
  );
  CREATE INDEX IF NOT EXISTS "IX_BrowserSessionFamilies_user_created"
    ON "BrowserSessionFamilies"(user_id,created_at DESC);

  -- Legacy sessions have no trustworthy human-activity timestamp. Require a fresh login
  -- instead of silently adopting the previous seven-day refresh lifetime.
  INSERT INTO "BrowserSessionFamilies"(
    family_id,user_id,created_at,expires_at,last_activity_at,revoked_at
  )
    SELECT family_id,MIN(user_id),MIN(created_at),MAX(expires_at),
      LEAST(MAX(created_at),MAX(expires_at)),CURRENT_TIMESTAMP
    FROM "BrowserSessions" GROUP BY family_id
    ON CONFLICT(family_id) DO NOTHING;
  UPDATE "BrowserSessions" SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP);
  UPDATE "BrowserSessionFamilies" SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP);

  IF NOT EXISTS(
    SELECT 1 FROM pg_constraint
    WHERE conrelid='"BrowserSessions"'::regclass AND conname='FK_BrowserSessions_family'
  ) THEN
    ALTER TABLE "BrowserSessions" ADD CONSTRAINT "FK_BrowserSessions_family"
      FOREIGN KEY(family_id) REFERENCES "BrowserSessionFamilies"(family_id);
  END IF;
  INSERT INTO "SchemaMigrations"(version) VALUES(8);
END;
$migration$;
