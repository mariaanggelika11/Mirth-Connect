DO $migration$
BEGIN
  IF EXISTS(SELECT 1 FROM "SchemaMigrations" WHERE version=6) THEN RETURN; END IF;
  ALTER TABLE "MessageDestinationLog" ADD COLUMN IF NOT EXISTS http_status integer CHECK (http_status BETWEEN 100 AND 599);
  INSERT INTO "SchemaMigrations"(version) VALUES(6);
END;
$migration$;
