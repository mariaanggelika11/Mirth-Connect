# ADR: channel revision lifecycle

Status: implemented; production workload verification required.

Problem: replacing a running channel's source/script/destination configuration immediately makes accepted work difficult to reproduce and rollback unreliable.

Decision: retain Channels/Destinations as the compatible materialized runtime API. Store encrypted immutable ChannelRevisions with number/state/checksum/summary/actor/timestamps; migrate existing channels as their first published revision. PUT channel saves a draft and preserves runtime state. Publish and rollback lock the channel and compare expectedActiveRevision; activation creates a new published snapshot. Rollback reuses a historical configuration but creates new activation history. Draft activation marks its source draft archived; active published snapshots remain immutable.

Inbound reads source and destination snapshot under a shared channel lock. Jobs record the accepted channel revision and encrypted destination/final payload; retry never rereads active scripts. Source API keys remain live channel credentials independent of revisions, preventing rollback from reviving an old credential. Diff omits endpoint auth/query and all script contents; script checksums are a future enhancement. Removed destinations retain their historical IDs. Revision history makes channel DELETE return a safe conflict; STOPPED retires the channel.

Compatibility note: existing routes and success envelopes remain, but clients expecting PUT to change running configuration must now explicitly review/publish. See README V2 migration instructions. This is an intentional safety behavior change, not a claim of completely unchanged semantics.

Consequences: migration account needs new table/column/index permissions; runtime account needs CRUD on new session/runtime tables. Editing a saved draft in place and revision-specific dry-run through API are not implemented; edit runtime configuration to create a new draft, then validate/test before publishing. Compare shows sanitized before/after configuration rather than a full text patch.
