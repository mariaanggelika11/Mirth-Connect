DO $migration$
BEGIN
  IF EXISTS(SELECT 1 FROM "SchemaMigrations" WHERE version=5) THEN RETURN; END IF;
  ALTER TABLE "Destinations" ADD COLUMN IF NOT EXISTS delivery_policy jsonb NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE "Messages" ADD COLUMN IF NOT EXISTS idempotency_key_hash varchar(64);
  ALTER TABLE "Messages" ADD COLUMN IF NOT EXISTS dedupe_expires_at timestamptz;
  ALTER TABLE "Messages" ADD COLUMN IF NOT EXISTS canonical_request_hash varchar(64);
  UPDATE "Messages" SET idempotency_key_hash=dedupe_key WHERE direction='IN' AND dedupe_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS "IX_Messages_dedupe_expiry" ON "Messages"(dedupe_expires_at,id) WHERE dedupe_key IS NOT NULL AND dedupe_expires_at IS NOT NULL;
  INSERT INTO "SchemaMigrations"(version) VALUES(5);
END;
$migration$;
