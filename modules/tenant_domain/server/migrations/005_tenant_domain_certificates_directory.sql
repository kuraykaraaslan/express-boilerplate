-- kind: expand; reversible: true
-- tenant_domain 005: which certificate authority directory issued a certificate (docs/phases/51-domain-certificates, 51.5).
--
-- A row issued by another directory than the one the installation orders from now (the staging directory of a first round, a CA that was
-- replaced) counts as no certificate: it is ordered again, and it is not handed to the TLS terminator. Without this a staging certificate
-- would look fresh for 90 days after the switch to the production directory. Existing rows (none before phase 51.5) have NULL and are
-- treated as foreign. Idempotent.

ALTER TABLE "tenant_domain_certificates" ADD COLUMN IF NOT EXISTS "directoryUrl" varchar;
