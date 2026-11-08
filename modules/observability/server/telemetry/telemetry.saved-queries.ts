/**
 * Saved explorer queries (phase 18.2), stored in the tenant's own settings row as one JSON document: no entity, no migration.
 * A saved query is a validated STRUCTURED query without its time range. It is shared by the workspace's admins. Concurrent saves are
 * last-writer-wins (a read-modify-write of one setting); the cap and the size limit keep the document small.
 */
import { randomUUID } from 'node:crypto';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { SavedQueryInputSchema, validateSavedBody, type SavedQueryInput } from './telemetry.dto';
import { TELEMETRY_SETTING_KEYS } from './telemetry.setting.keys';

export const MAX_SAVED_QUERIES = 50;
const MAX_BODY_CHARS = 8_000;

export interface SavedQuery {
  id: string;
  name: string;
  signal: 'logs' | 'traces' | 'metrics';
  query: Record<string, unknown>;
  createdAt: string;
  createdBy?: string;
}

function parseStore(raw: string | null): SavedQuery[] {
  if (!raw) return [];
  try {
    const doc = JSON.parse(raw) as { v?: number; items?: unknown };
    if (doc?.v !== 1 || !Array.isArray(doc.items)) return [];
    return doc.items.filter((i): i is SavedQuery => !!i && typeof i === 'object' && typeof (i as SavedQuery).id === 'string' && typeof (i as SavedQuery).name === 'string'
      && ['logs', 'traces', 'metrics'].includes((i as SavedQuery).signal) && typeof (i as SavedQuery).query === 'object');
  } catch {
    return [];
  }
}

export async function listSavedQueries(tenantId: string): Promise<SavedQuery[]> {
  return parseStore(await SettingService.getValue(tenantId, TELEMETRY_SETTING_KEYS.SAVED_QUERIES));
}

async function write(tenantId: string, items: SavedQuery[], actorId?: string): Promise<void> {
  await SettingService.create(tenantId, TELEMETRY_SETTING_KEYS.SAVED_QUERIES, JSON.stringify({ v: 1, items }), 'observability', 'json', actorId ? { actorId } : undefined);
}

export async function createSavedQuery(tenantId: string, actorId: string | undefined, input: unknown): Promise<SavedQuery> {
  const dto: SavedQueryInput = SavedQueryInputSchema.parse(input);
  const query = validateSavedBody(dto.signal, dto.query);
  if (JSON.stringify(query).length > MAX_BODY_CHARS) throw new AppError('The saved query is too large', 400, ErrorCode.VALIDATION_ERROR);
  const items = await listSavedQueries(tenantId);
  if (items.length >= MAX_SAVED_QUERIES) throw new AppError(`A workspace may keep at most ${MAX_SAVED_QUERIES} saved queries`, 409, ErrorCode.CONFLICT);
  if (items.some((i) => i.name.toLowerCase() === dto.name.toLowerCase() && i.signal === dto.signal)) throw new AppError('A saved query with this name already exists', 409, ErrorCode.CONFLICT);
  const saved: SavedQuery = { id: randomUUID(), name: dto.name, signal: dto.signal, query, createdAt: new Date().toISOString(), ...(actorId ? { createdBy: actorId } : {}) };
  await write(tenantId, [...items, saved], actorId);
  return saved;
}

export async function deleteSavedQuery(tenantId: string, actorId: string | undefined, id: string): Promise<boolean> {
  const items = await listSavedQueries(tenantId);
  const next = items.filter((i) => i.id !== id);
  if (next.length === items.length) return false;
  await write(tenantId, next, actorId);
  return true;
}
