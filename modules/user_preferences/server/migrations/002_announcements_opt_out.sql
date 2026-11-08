-- kind: expand; reversible: true
-- user_preferences 002: `announcements`, the opt-out of general announcements by mail, push and SMS
-- (docs/phases/47-announcements, D16). On by default: every existing row gets true, which is what it read before the
-- column existed (the category did not exist, so nothing held it back). Maintenance notices do not ask it.
--   Reverse: ALTER TABLE "user_preferences" DROP COLUMN IF EXISTS "announcements";
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "announcements" boolean NOT NULL DEFAULT true;
