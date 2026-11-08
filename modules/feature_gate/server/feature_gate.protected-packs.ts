import fs from 'node:fs/promises';
import Logger from '@kuraykaraaslan-labs/logger';
import { env } from '@kuraykaraaslan-labs/env';
import { ext, systemCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { featureGateEntitlementCeilingLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/feature_gate.entitlement_ceiling';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { tenantPath } from '@kuraykaraaslan-labs/common/server/tenant-path';
import type { EntitlementCeilingProvider } from './feature_gate.types';
import { FEATURE_GATE_CEILING_POINT } from './feature_gate.ceiling';
import { applyMark, type MarkableLiteral } from './feature_gate.pack-mark';
import { buildPack, builtPackPaths, MARK_PLACEHOLDER, parsePackDeclaration, PROTECTED_PACKS_POINT, type PackDeclaration, type VendorKey } from './feature_gate.pack-build';
import { newPackMark, PACK_TICKET_TTL_SECONDS, signPackTicket, verifyPackTicket, type PackTicketClaims } from './feature_gate.pack-ticket';

/**
 * Protected packs (dashboard phase 33, ADR-0016): the code of paid content, served behind a ticket instead of as a public chunk.
 *
 * - **Declarations** come from `feature_gate:protected_packs` (metadata only, read in a system context, once per process).
 * - **Tickets** (`issuePackTicket`) are asked for by the module that owns the packs, from its own route, after it decided who the
 *   subject is and which packs it may have. Each ticket has a fresh mark, and its issue is an audit row (`feature_gate.pack.ticket`,
 *   strict: no row, no ticket), so every served copy can be traced to the download.
 * - **Serving** (`servePack`) checks only the ticket and writes the ticket's mark into the pack (`feature_gate.pack-mark.ts`).
 *   Production reads the build's output (`scripts/build-protected-packs.mts`, `.protected-packs/`); development builds on demand.
 * - **The licence** a pack verifies in the browser is the deployment's signed licence, from the entitlement ceiling providers.
 */

export type PackSubject = { kind: 'user'; userId: string } | { kind: 'display'; displayLinkId: string };

export interface PackTicketAnswer {
  ticket: string;
  packs: string[];
  /** Pack id -> the URL that serves it under this ticket (tenant-addressed). */
  urls: Record<string, string>;
  expiresAt: number;
  /** The deployment's signed licence while it holds (a pack checks its origin against it), else null. */
  licence: { license: object; sig: string } | null;
}

let declared: Promise<ReadonlyMap<string, ReadonlyMap<string, PackDeclaration>>> | null = null;

async function readDeclarations(): Promise<ReadonlyMap<string, ReadonlyMap<string, PackDeclaration>>> {
  const out = new Map<string, Map<string, PackDeclaration>>();
  for (const c of await ext.contributions(PROTECTED_PACKS_POINT, systemCtx('feature_gate protected pack declarations'))) {
    const parsed = parsePackDeclaration(c.moduleId, c.key ?? '', c.metadata);
    if (!parsed.ok) {
      Logger.warn(`[feature_gate] ignoring a malformed protected pack declaration of '${c.moduleId}': ${parsed.reason}`);
      continue;
    }
    const packs = out.get(c.moduleId) ?? new Map<string, PackDeclaration>();
    packs.set(parsed.pack.packId, parsed.pack);
    out.set(c.moduleId, packs);
  }
  return out;
}

/** The protected packs one module declares (empty for a module that declares none). */
export async function protectedPacksOf(moduleId: string): Promise<ReadonlyMap<string, PackDeclaration>> {
  declared ??= readDeclarations().catch((error: unknown) => { declared = null; throw error; });
  return (await declared).get(moduleId) ?? new Map();
}

/** Asks every entitlement ceiling provider for one optional answer; the first non-null wins, a failure counts as none. */
async function fromCeilingProviders<T>(ask: (p: EntitlementCeilingProvider) => Promise<T | null> | T | null | undefined): Promise<T | null> {
  try {
    const { results } = await ext.aggregate<EntitlementCeilingProvider, T | null>(
      FEATURE_GATE_CEILING_POINT, systemCtx('feature_gate protected pack licence'), featureGateEntitlementCeilingLoaders,
      async (provider) => (await ask(provider)) ?? null,
    );
    return results.map((r) => r.value).find((v): v is T => v !== null && v !== undefined) ?? null;
  } catch (error) {
    Logger.warn(`[feature_gate] protected packs: a licence provider could not answer: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** The deployment's signed licence while it holds, for a pack's origin check. */
export const deploymentSignedLicence = () => fromCeilingProviders((p) => p.signedLicence?.() ?? null);

/** The vendor keys of this deployment's trust root, which a development build gives the packs. */
export const deploymentVendorKeys = async (): Promise<readonly VendorKey[]> => (await fromCeilingProviders((p) => p.vendorKeys?.() ?? null)) ?? [];

/** The URL that serves a pack under a ticket. */
export const packUrl = (tenantId: string, moduleId: string, packId: string, ticket: string): string =>
  `${tenantPath(tenantId, `/api/feature_gate/packs/${moduleId}/${packId}`)}?t=${encodeURIComponent(ticket)}`;

/**
 * A ticket for `packs` of `moduleId` (the caller decided the subject may have them). Packs the module does not declare are dropped.
 * The issue is written to the audit log first; when that fails there is no ticket (503), so nothing is served unlogged.
 */
export async function issuePackTicket(args: {
  tenantId: string;
  moduleId: string;
  packs: readonly string[];
  subject: PackSubject;
  ipAddress?: string | null;
  userAgent?: string | null;
  nowSeconds?: number;
}): Promise<PackTicketAnswer> {
  const declaredPacks = await protectedPacksOf(args.moduleId);
  const packs = [...new Set(args.packs)].filter((p) => declaredPacks.has(p)).sort();
  const mark = newPackMark();
  const expiresAt = (args.nowSeconds ?? Math.floor(Date.now() / 1000)) + PACK_TICKET_TTL_SECONDS;
  const subject = args.subject.kind === 'user' ? `u:${args.subject.userId}` : `d:${args.subject.displayLinkId}`;
  const claims: PackTicketClaims = { t: args.tenantId, m: args.moduleId, p: packs, k: mark, e: expiresAt, s: subject };
  try {
    const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service');
    await AuditLogService.log({
      tenantId: args.tenantId,
      actorId: args.subject.kind === 'user' ? args.subject.userId : null,
      actorType: args.subject.kind === 'user' ? 'USER' : 'SYSTEM',
      action: 'feature_gate.pack.ticket',
      resourceType: 'ProtectedPack',
      resourceId: `${args.moduleId}:${mark}`,
      metadata: { module: args.moduleId, packs, mark, subject, expiresAt },
      ipAddress: args.ipAddress ?? null,
      userAgent: args.userAgent ? args.userAgent.slice(0, 512) : null,
    }, { strict: true });
  } catch (error) {
    Logger.error(`[feature_gate] a pack ticket was refused: its download could not be logged (${error instanceof Error ? error.message : String(error)})`);
    throw new AppError('The download log is not available; try again in a moment', 503, ErrorCode.INTERNAL_ERROR, { details: { reason: 'pack_log_unavailable' } });
  }
  const ticket = signPackTicket(claims, env.ACCESS_TOKEN_SECRET);
  return {
    ticket,
    packs,
    urls: Object.fromEntries(packs.map((p) => [p, packUrl(args.tenantId, args.moduleId, p, ticket)])),
    expiresAt,
    licence: await deploymentSignedLicence(),
  };
}

interface LoadedPack {
  code: string;
  literals: MarkableLiteral[];
}

/** A production server reads the build's output; anything else (dev, a test) builds on demand. */
const production = () => env.NODE_ENV === 'production' || env.NODE_ENV === 'vercel';
const loaded = new Map<string, Promise<LoadedPack>>();
const devBuilt = new Map<string, { at: number; pack: Promise<LoadedPack> }>();
const DEV_REBUILD_MS = 1000;

async function readBuilt(decl: PackDeclaration): Promise<LoadedPack> {
  const paths = builtPackPaths(process.cwd(), decl.moduleId, decl.packId);
  const [code, literals] = await Promise.all([fs.readFile(paths.code, 'utf8'), fs.readFile(paths.literals, 'utf8')]);
  return { code, literals: (JSON.parse(literals) as { literals: MarkableLiteral[] }).literals };
}

/** A pack's built code and its markable literals: the build's output in production, an on-demand build in development. */
export async function loadPack(decl: PackDeclaration): Promise<LoadedPack> {
  const key = `${decl.moduleId}/${decl.packId}`;
  if (production()) {
    let hit = loaded.get(key);
    if (!hit) {
      hit = readBuilt(decl).catch((error: unknown) => { loaded.delete(key); throw error; });
      loaded.set(key, hit);
    }
    return hit;
  }
  const cached = devBuilt.get(key);
  if (cached && Date.now() - cached.at < DEV_REBUILD_MS) return cached.pack;
  const pack = deploymentVendorKeys().then((vendorKeys) => buildPack(decl, { root: process.cwd(), vendorKeys }));
  devBuilt.set(key, { at: Date.now(), pack });
  pack.catch(() => devBuilt.delete(key));
  return pack;
}

/** What the pack route answers: the marked code, or null for anything it must refuse (a 403 with no body). */
export async function servePack(args: { tenantId: string; moduleId: string; packId: string; ticket: string | null; nowSeconds?: number }): Promise<string | null> {
  if (!args.ticket) return null;
  const claims = verifyPackTicket(args.ticket, env.ACCESS_TOKEN_SECRET, args.nowSeconds);
  if (!claims || claims.t !== args.tenantId || claims.m !== args.moduleId || !claims.p.includes(args.packId)) return null;
  const decl = (await protectedPacksOf(args.moduleId)).get(args.packId);
  if (!decl) return null;
  const pack = await loadPack(decl);
  return applyMark(pack.code, pack.literals, claims.k).replace(MARK_PLACEHOLDER, `kuimark:${claims.k}`);
}

/** Forget the declarations and the loaded packs. For tests. */
export function resetProtectedPacks(): void {
  declared = null;
  loaded.clear();
  devBuilt.clear();
}
