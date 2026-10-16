DO $migration$
BEGIN
  IF EXISTS(SELECT 1 FROM "SchemaMigrations" WHERE version=7) THEN RETURN; END IF;
  ALTER TABLE "MessageDestinationLog" ADD COLUMN IF NOT EXISTS request_duration_ms integer CHECK (request_duration_ms >= 0);
  INSERT INTO "SchemaMigrations"(version) VALUES(7);
END;
$migration$;
