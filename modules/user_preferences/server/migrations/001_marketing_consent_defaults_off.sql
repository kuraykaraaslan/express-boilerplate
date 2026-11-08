-- kind: expand; reversible: true
-- user_preferences 001: marketing consents default OFF (docs/phases/40-ui-fixes/06-user.md 1.3).
--
--   user_preferences.newsletter, .productUpdates   column default true -> false: consent is opt-in, never a default. Mirrors the entity.
--                                                  Only the DEFAULT changes; no row is updated, so every existing row keeps the value
--                                                  stored for it (a person who consented stays consented, and the reverse).
--   Reverse: SET DEFAULT true on both columns.
--
ALTER TABLE "user_preferences" ALTER COLUMN "newsletter" SET DEFAULT false;
ALTER TABLE "user_preferences" ALTER COLUMN "productUpdates" SET DEFAULT false;
