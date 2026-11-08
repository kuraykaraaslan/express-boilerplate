import 'reflect-metadata';
import type { FindOptionsWhere } from 'typeorm';
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts';
import { TenantDomain } from './entities/tenant_domain.entity';

/**
 * Demo-data seed for the `tenant_domain` module.
 *
 * A tenant's custom hostnames plus their DNS-verification and SSL/TLS state.
 * `TenantDomain` carries a `tenantId` column, so every row is tenant-scoped
 * (`ctx.repo`) and stamped with `ctx.tenantId`.
 *
 * House rules (see store.seed.ts):
 *  - Always go through `ctx.foc(repo, where, create)` with a natural key in
 *    `where`. The entity's only @unique column is `domain`, so that is the key.
 *  - Use *valid* enum values only — domainStatus ∈ DomainStatusEnum
 *    (ACTIVE / INACTIVE / PENDING / VERIFIED / DNS_FAILED) and sslStatus ∈
 *    SslStatusEnum (DISABLED / PENDING / PROVISIONING / ACTIVE / EXPIRING /
 *    EXPIRED / FAILED).
 *  - Timestamps are real Date objects; decimals would be numbers (none here).
 *  - Cover the module with varied rows: a fully-verified primary domain with a
 *    live cert, a pending domain still awaiting DNS, and a failed alias whose
 *    cert has expired.
 */
export async function seedTenantDomain(ctx: SeedContext): Promise<void> {
  const { tenantId, foc } = ctx;
  const repo = ctx.repo<TenantDomain>(TenantDomain);

  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
  const daysFromNow = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

  // A domain key is unique globally, so namespace the seed hostnames per tenant
  // to keep re-runs idempotent across multiple seeded tenants.
  // The LAST 8 hex digits: seeded tenant ids share their leading digits
  // (00000000-…-000000000000 / …-000000000001), so a prefix collided across tenants.
  const shortTenant = tenantId.replace(/-/g, '').slice(-8);

  type DomainDef = {
    domain: string;
    isPrimary: boolean;
    domainStatus: string;
    verificationToken?: string;
    verifiedAt?: Date;
    sslStatus: string;
    sslIssuedAt?: Date;
    sslExpiresAt?: Date;
    sslIssuer?: string;
    sslLastCheckedAt?: Date;
    createdAt?: Date;
  };

  const defs: DomainDef[] = [
    // Primary, fully verified, live Let's Encrypt cert renewed last week.
    {
      domain: `seed-${shortTenant}.example.com`,
      isPrimary: true,
      domainStatus: 'ACTIVE',
      verificationToken: `seed-verify-${shortTenant}-primary`,
      verifiedAt: daysAgo(20),
      sslStatus: 'ACTIVE',
      sslIssuedAt: daysAgo(7),
      sslExpiresAt: daysFromNow(83),
      sslIssuer: "Let's Encrypt Authority X3",
      sslLastCheckedAt: daysAgo(1),
      createdAt: daysAgo(30),
    },
    // Newly added alias, DNS still propagating — no cert yet.
    {
      domain: `seed-${shortTenant}-staging.example.net`,
      isPrimary: false,
      domainStatus: 'PENDING',
      verificationToken: `seed-verify-${shortTenant}-staging`,
      sslStatus: 'DISABLED',
      createdAt: daysAgo(2),
    },
    // Verified but DNS check later failed; the cert it once had has expired.
    {
      domain: `seed-${shortTenant}-legacy.example.org`,
      isPrimary: false,
      domainStatus: 'DNS_FAILED',
      verificationToken: `seed-verify-${shortTenant}-legacy`,
      verifiedAt: daysAgo(120),
      sslStatus: 'EXPIRED',
      sslIssuedAt: daysAgo(150),
      sslExpiresAt: daysAgo(60),
      sslIssuer: "Let's Encrypt Authority X3",
      sslLastCheckedAt: daysAgo(3),
      createdAt: daysAgo(160),
    },
  ];

  // One primary per tenant (the product's own rule, which setPrimary enforces): a tenant that already has one, such as the
  // free subdomain the bootstrap gives every tenant, keeps it, and the seeded custom domain joins as an active alias.
  // Two primaries made links, the origin resolver and the tenant switch pick either, including this unreachable one.
  const existingPrimary = await repo.findOne({ where: { tenantId, isPrimary: true } as FindOptionsWhere<TenantDomain> });
  if (existingPrimary && existingPrimary.domain !== defs[0].domain) defs[0].isPrimary = false;

  let primaryDomainId: string | undefined = existingPrimary && !defs[0].isPrimary ? existingPrimary.tenantDomainId : undefined;
  for (const def of defs) {
    const row = await foc(repo,
      { tenantId, domain: def.domain } as FindOptionsWhere<TenantDomain>,
      { tenantId, ...def },
    );
    if (def.isPrimary) primaryDomainId = row.tenantDomainId;
  }

  // Publish references later modules might consume.
  ctx.refs.tenantDomainId = primaryDomainId;
  ctx.refs.primaryDomain = defs[0].isPrimary ? defs[0].domain : existingPrimary?.domain ?? defs[0].domain;

  ctx.log(`tenant_domain: ${defs.length} domains (primary/active, pending, dns-failed) for ${tenantId}`);
}
