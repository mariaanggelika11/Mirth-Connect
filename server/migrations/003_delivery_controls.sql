DO $migration$
BEGIN
  IF EXISTS(SELECT 1 FROM "SchemaMigrations" WHERE version=3) THEN RETURN; END IF;
  ALTER TABLE "Messages" ADD COLUMN IF NOT EXISTS lease_owner text NOT NULL DEFAULT gen_random_uuid()::text;
  CREATE TABLE IF NOT EXISTS "DestinationRuntime" (
    destination_id bigint PRIMARY KEY REFERENCES "Destinations"(id),
    failure_count integer NOT NULL DEFAULT 0,
    open_until timestamptz, probe_until timestamptz,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS "DeliverySlots" (
    message_id bigint PRIMARY KEY REFERENCES "Messages"(id),
    destination_id bigint NOT NULL REFERENCES "Destinations"(id),
    owner text NOT NULL, expires_at timestamptz NOT NULL
  );
  CREATE INDEX IF NOT EXISTS "IX_DeliverySlots_expiry" ON "DeliverySlots"(expires_at,destination_id);
  INSERT INTO "SchemaMigrations"(version) VALUES(3);
END;
$migration$;
