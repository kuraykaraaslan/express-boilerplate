# announcement migrations

Numbered SQL owned by `announcement`, applied once each by the `db` deploy runner as `announcement:<file>`.

| File | Purpose |
|---|---|
| `001_announcements.sql` | the `announcements` and `announcement_receipts` tables (docs/phases/47-announcements, 47.1); RLS policies come from the generated tenant `127_rls_policy_hardening.sql` |

Next free number: **002**.
