/**
 * Saved metric panels (phase 18.4), stored like saved queries: one JSON document in the tenant's own settings row, no entity, no migration.
 * A panel is a validated STRUCTURED metric query without a time range plus the range it opens on, so it is as safe as the query API and as
 * small as a saved query. It is shared by the workspace's admins; concurrent saves are last-writer-wins; the cap and the size limit keep
 * the document small.
 */
import { randomUUID } from 'node:crypto';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { SavedPanelInputSchema, type SavedPanelInput } from './telemetry.dto';
import { TELEMETRY_SETTING_KEYS } from './telemetry.setting.keys';
import { isTenantKey } from './telemetry.tenant';

export const MAX_SAVED_PANELS = 50;
const MAX_BODY_CHARS = 4_000;

export interface SavedPanel {
  id: string;
  name: string;
  rangePreset: SavedPanelInput['rangePreset'];
  showExemplars: boolean;
  query: SavedPanelInput['query'];
  createdAt: string;
  createdBy?: string;
}

function parseStore(raw: string | null): SavedPanel[] {
  if (!raw) return [];
  try {
    const doc = JSON.parse(raw) as { v?: number; items?: unknown };
    if (doc?.v !== 1 || !Array.isArray(doc.items)) return [];
    // A stored panel is trusted no further than a request: it goes through the same schema on the way out, so a hand-edited setting cannot
    // put a field in front of a screen that the API would have refused.
    return doc.items.flatMap((i): SavedPanel[] => {
      const it = i as Partial<SavedPanel> | null;
      if (!it || typeof it.id !== 'string' || typeof it.createdAt !== 'string') return [];
      const parsed = SavedPanelInputSchema.safeParse({ name: it.name, rangePreset: it.rangePreset, showExemplars: it.showExemplars, query: it.query });
      return parsed.success ? [{ id: it.id, ...parsed.data, createdAt: it.createdAt, ...(typeof it.createdBy === 'string' ? { createdBy: it.createdBy } : {}) }] : [];
    });
  } catch {
    return [];
  }
}

export async function listSavedPanels(tenantId: string): Promise<SavedPanel[]> {
  return parseStore(await SettingService.getValue(tenantId, TELEMETRY_SETTING_KEYS.SAVED_PANELS));
}

async function write(tenantId: string, items: SavedPanel[], actorId?: string): Promise<void> {
  await SettingService.create(tenantId, TELEMETRY_SETTING_KEYS.SAVED_PANELS, JSON.stringify({ v: 1, items }), 'observability', 'json', actorId ? { actorId } : undefined);
}

export async function createSavedPanel(tenantId: string, actorId: string | undefined, input: unknown): Promise<SavedPanel> {
  const dto = SavedPanelInputSchema.parse(input);
  // Same rule as the query API: a filter or a grouping aimed at the tenant label is refused outright.
  if ([...dto.query.filters.map((f) => f.field), ...dto.query.groupBy].some(isTenantKey)) throw new AppError('That field name is reserved', 400, ErrorCode.VALIDATION_ERROR);
  if (JSON.stringify(dto.query).length > MAX_BODY_CHARS) throw new AppError('The saved panel is too large', 400, ErrorCode.VALIDATION_ERROR);
  const items = await listSavedPanels(tenantId);
  if (items.length >= MAX_SAVED_PANELS) throw new AppError(`A workspace may keep at most ${MAX_SAVED_PANELS} saved panels`, 409, ErrorCode.CONFLICT);
  if (items.some((i) => i.name.toLowerCase() === dto.name.toLowerCase())) throw new AppError('A saved panel with this name already exists', 409, ErrorCode.CONFLICT);
  const saved: SavedPanel = { id: randomUUID(), ...dto, createdAt: new Date().toISOString(), ...(actorId ? { createdBy: actorId } : {}) };
  await write(tenantId, [...items, saved], actorId);
  return saved;
}

export async function deleteSavedPanel(tenantId: string, actorId: string | undefined, id: string): Promise<boolean> {
  const items = await listSavedPanels(tenantId);
  const next = items.filter((i) => i.id !== id);
  if (next.length === items.length) return false;
  await write(tenantId, next, actorId);
  return true;
}
