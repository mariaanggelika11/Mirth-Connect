-- Run inside the migrator transaction. Additive and repeatable.
DO $migration$
BEGIN
  IF EXISTS(SELECT 1 FROM "SchemaMigrations" WHERE version=2) THEN RETURN; END IF;
  CREATE TABLE IF NOT EXISTS "BrowserSessions" (
    token_hash varchar(64) PRIMARY KEY, family_id text NOT NULL,
    user_id bigint NOT NULL REFERENCES "Users"(id), csrf_hash varchar(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamptz NOT NULL, used_at timestamptz, revoked_at timestamptz
  );
  CREATE INDEX IF NOT EXISTS "IX_BrowserSessions_family" ON "BrowserSessions"(family_id);
  ALTER TABLE "Messages" ADD COLUMN IF NOT EXISTS request_hash varchar(64);
  ALTER TABLE "Messages" ADD COLUMN IF NOT EXISTS channel_revision integer;
  ALTER TABLE "Channels" ADD COLUMN IF NOT EXISTS validation_profile text NOT NULL DEFAULT '{}';
  ALTER TABLE "Channels" ADD COLUMN IF NOT EXISTS active_revision integer NOT NULL DEFAULT 0;
  ALTER TABLE "Channels" ADD COLUMN IF NOT EXISTS idempotency_mode text NOT NULL DEFAULT 'OPTIONAL';
  CREATE TABLE IF NOT EXISTS "ChannelRevisions" (
    channel_id bigint NOT NULL REFERENCES "Channels"(id), revision integer NOT NULL,
    state text NOT NULL CHECK(state IN ('DRAFT','PUBLISHED','ARCHIVED')),
    configuration text NOT NULL, checksum varchar(64) NOT NULL, change_summary text NOT NULL,
    created_by bigint, created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at timestamptz, PRIMARY KEY(channel_id, revision)
  );
  CREATE TABLE IF NOT EXISTS "DeadLetterCases" (
    message_id bigint PRIMARY KEY REFERENCES "Messages"(id),
    state text NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','ACKNOWLEDGED','IN_REVIEW','RESOLVED','IGNORED')),
    assigned_to bigint REFERENCES "Users"(id), category text NOT NULL DEFAULT '',
    note text NOT NULL DEFAULT '', updated_by bigint, updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at timestamptz
  );
  INSERT INTO "SchemaMigrations"(version) VALUES(2);
END;
$migration$;
