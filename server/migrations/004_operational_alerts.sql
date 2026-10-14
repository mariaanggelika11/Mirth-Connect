DO $migration$
BEGIN
  IF EXISTS(SELECT 1 FROM "SchemaMigrations" WHERE version=4) THEN RETURN; END IF;
  CREATE TABLE IF NOT EXISTS "OperationalAlerts" (
    code text PRIMARY KEY,
    active boolean NOT NULL,
    delivery_pending boolean NOT NULL DEFAULT true,
    state text NOT NULL CHECK(state IN ('OPEN','ACKNOWLEDGED','RECOVERED')),
    last_attempt_at timestamptz NOT NULL,
    last_notified_at timestamptz,
    first_seen_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    acknowledged_by bigint REFERENCES "Users"(id),
    acknowledged_at timestamptz
  );
  INSERT INTO "SchemaMigrations"(version) VALUES(4);
END;
$migration$;
