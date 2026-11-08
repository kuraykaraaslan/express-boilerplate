/**
 * Embedding similarity for similar-incident retrieval (observability phase 20.2, work order 2 item 2). Behind the tenant flag
 * `similarByEmbedding` (off by default): with it off nothing here runs, nothing is embedded and nothing is stored.
 *
 *  - Embeddings come from the `ai` module through `EmbedPort` (the tenant's own provider, from its allow-list, under the plan and token gate of
 *    `ai`), never from a provider import.
 *  - A vector is L2-normalised and stored as `real[]` in `incident_embeddings` (migration 070); similarity is cosine, computed here, over the
 *    tenant's recent resolved incidents of the SAME model (a vector from another model is never compared). pgvector is not needed: one lookup
 *    compares against at most `MAX_CANDIDATES` rows of one tenant, and no database extension is required to deploy.
 *  - `textHash` skips an incident whose text did not change. A daily cap (`EMBEDDING_DAILY_CAP`) bounds the embedding calls per tenant,
 *    whatever triggers them (a resolve, a lookup, a backfill).
 *  - Nothing here ever throws into a caller: a missing provider, a refused plan or a bad vector is "no embedding match".
 */
import { createHash } from 'node:crypto';
import { MoreThanOrEqual } from 'typeorm';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { loadAiPeer } from './peers/peers';
import Logger from '@kuraykaraaslan-labs/logger';
import { IncidentEmbedding } from './entities/incident_embedding.entity';
import { Incident } from './entities/incident.entity';
import { getAiSettings } from './ai/ai.settings';

export const EMBEDDING_DAILY_CAP = 200;
export const MAX_CANDIDATES = 300;
export const MAX_EMBED_TEXT = 6000;
export const MIN_SIMILARITY = 0.55;
export const MAX_DIMS = 4096;

export interface EmbedPort {
  embed(tenantId: string, req: { input: string; provider: string; model?: string }): Promise<{ vector: number[]; provider: string; model: string }>;
}

/** The real port: `AIService.embed` for the tenant. `ai` is optional; without it the port throws and the caller reads "no embedding". */
export const aiModuleEmbedder: EmbedPort = {
  async embed(tenantId, req) {
    const svc = await loadAiPeer(tenantId);
    if (!svc) throw new Error('ai module not active');
    const r = await svc.embed(tenantId, { input: req.input, provider: req.provider, ...(req.model ? { model: req.model } : {}) });
    const vector = r.embeddings[0];
    if (!Array.isArray(vector)) throw new Error('no embedding returned');
    return { vector, provider: r.provider, model: r.model };
  },
};

// ── pure ──────────────────────────────────────────────────────────────────────

/** L2-normalised copy; null for an empty, non-finite, zero or oversized vector. */
export function normalize(v: readonly number[]): number[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_DIMS) return null;
  let sum = 0;
  for (const x of v) { if (typeof x !== 'number' || !Number.isFinite(x)) return null; sum += x * x; }
  if (sum === 0) return null;
  const n = Math.sqrt(sum);
  return v.map((x) => x / n);
}

/** Cosine similarity of two vectors that are already L2-normalised (a dot product). Different lengths are never similar. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return -1;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot;
}

export const textHash = (text: string): string => createHash('sha256').update(text).digest('hex');

export interface EmbeddingMatch { incidentId: string; score: number }

/** The best `limit` candidates at or above `min`, best first, excluding `selfId`. Pure. */
export function rankBySimilarity(query: readonly number[], candidates: ReadonlyArray<{ incidentId: string; vector: readonly number[] }>, opts: { selfId?: string; min?: number; limit?: number } = {}): EmbeddingMatch[] {
  const min = opts.min ?? MIN_SIMILARITY;
  return candidates
    .filter((c) => c.incidentId !== opts.selfId)
    .map((c) => ({ incidentId: c.incidentId, score: cosine(query, c.vector) }))
    .filter((m) => m.score >= min)
    .sort((a, b) => b.score - a.score || a.incidentId.localeCompare(b.incidentId))
    .slice(0, opts.limit ?? 5);
}

// ── effects ───────────────────────────────────────────────────────────────────

const dayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

async function embeddedToday(tenantId: string, now: Date): Promise<number> {
  return withTenantRepositoryFor(tenantId, IncidentEmbedding, (repo) => repo.count({ where: { tenantId, updatedAt: MoreThanOrEqual(dayStart(now)) } }));
}

interface Active { provider: string; model?: string }

/** The provider and model to embed with, or null when the tenant has not turned embedding similarity on. */
export async function embeddingSettings(tenantId: string): Promise<Active | null> {
  const s = await getAiSettings(tenantId);
  if (!s.enabled || !s.similarByEmbedding || !s.providers[0]) return null;
  return { provider: s.providers[0], ...(s.embeddingModel ? { model: s.embeddingModel } : {}) };
}

/** Embed and store one incident's text (skipped when unchanged or over the daily cap). Returns the stored vector, or null. */
export async function ensureIncidentEmbedding(tenantId: string, incidentId: string, text: string, port: EmbedPort = aiModuleEmbedder, now: Date = new Date()): Promise<{ vector: number[]; model: string } | null> {
  try {
    const active = await embeddingSettings(tenantId);
    if (!active) return null;
    const input = text.slice(0, MAX_EMBED_TEXT);
    const hash = textHash(input);
    const existing = await withTenantRepositoryFor(tenantId, IncidentEmbedding, (repo) => repo.find({ where: { tenantId, incidentId }, take: 5 }));
    const same = existing.find((e) => e.textHash === hash && (!active.model || e.model === active.model));
    if (same) return { vector: same.vector, model: same.model };
    if ((await embeddedToday(tenantId, now)) >= EMBEDDING_DAILY_CAP) return null;
    const r = await port.embed(tenantId, { input, provider: active.provider, model: active.model });
    const vector = normalize(r.vector);
    if (!vector) return null;
    await withTenantRepositoryFor(tenantId, IncidentEmbedding, async (repo) => {
      const row = existing.find((e) => e.model === r.model) ?? repo.create({ tenantId, incidentId, model: r.model } as never);
      Object.assign(row, { provider: r.provider, model: r.model, dims: vector.length, vector, textHash: hash });
      await repo.save(row as never);
    });
    return { vector, model: r.model };
  } catch (e) {
    Logger.warn(`[incident.embedding] ${incidentId}: ${e instanceof Error ? e.name : 'error'}: ${e instanceof Error ? e.message.slice(0, 200) : ''}`);
    return null;
  }
}

/**
 * Similar RESOLVED incidents by embedding: the lookup text is embedded (or its stored vector reused), compared with the stored vectors of the
 * tenant's most recent resolved incidents of the same model. `[]` when the flag is off, nothing is stored yet or the provider refuses.
 */
export async function similarByEmbedding(tenantId: string, incident: Pick<Incident, 'incidentId'>, text: string, port: EmbedPort = aiModuleEmbedder, now: Date = new Date()): Promise<EmbeddingMatch[]> {
  const own = await ensureIncidentEmbedding(tenantId, incident.incidentId, text, port, now);
  if (!own) return [];
  const rows = await withTenantRepositoryFor(tenantId, IncidentEmbedding, (repo) => repo.find({ where: { tenantId, model: own.model }, order: { updatedAt: 'DESC' }, take: MAX_CANDIDATES }));
  return rankBySimilarity(own.vector, rows.map((r) => ({ incidentId: r.incidentId, vector: r.vector })), { selfId: incident.incidentId });
}

export async function removeIncidentEmbeddings(tenantId: string, incidentId: string): Promise<void> {
  await withTenantRepositoryFor(tenantId, IncidentEmbedding, (repo) => repo.delete({ tenantId, incidentId })).catch(() => undefined);
}
