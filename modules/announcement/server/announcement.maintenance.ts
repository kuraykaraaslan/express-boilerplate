import 'reflect-metadata';
import { In, type Repository } from 'typeorm';
import { withSystemRLS } from '@kuraykaraaslan-labs/db';
import Logger from '@kuraykaraaslan-labs/logger';
import { createServerT } from '@kuraykaraaslan-labs/i18n/server/messages';
import type { MaintenanceEventKind, MaintenanceEventMeta } from '@kuraykaraaslan-labs/tenant/server/maintenance.events';
import type { MaintenanceWindowView } from '@kuraykaraaslan-labs/tenant/server/maintenance.dto';
import { dictionaries } from '../dictionaries';
import { Announcement, type AnnouncementAudience, type AnnouncementText } from './entities/announcement.entity';
import type { AnnouncementChannel, AnnouncementSeverity, MaintenanceStage } from './announcement.enums';
import AnnouncementService from './announcement.service';
import { liveWorkspaces, publishLive } from './announcement.live';

/**
 * Maintenance notices on announcements (docs/phases/47-announcements B, 47.4). A maintenance window makes its own
 * notices, one row per stage, which the window's managers can still edit or withdraw before they go out:
 *
 *  - scheduled: when the window is scheduled, after a short grace (so it can be edited) — skipped for a window that
 *    starts within the grace twice over (its start notice says it all);
 *  - reminder: on the scheduler's advance notice (`maintenancePreNotifyHours` before the start);
 *  - start: when it starts; a hand-started (forced) window is unplanned: critical, toast + banner + bell, mail for FULL;
 *  - end: when it ends ("resolved" after an unplanned start), or when it is cancelled after people were told.
 *
 * While the window runs, the start notice's banner stays on every page and cannot be closed (D17); the end expires it.
 * Maintenance mail is service mail (D16, announcement.delivery). The audience follows the window's scope: SYSTEM is
 * everyone, TENANT and ROUTE the window's workspace (a ROUTE window's users are not told apart by route: everyone of the
 * workspace hears it).
 *
 * Wired as a listener of `tenant`'s maintenance events (registered at boot, like the status-page bridge); `tenant`
 * imports nothing of this module.
 */

/** How long a scheduled notice waits before it goes out, so a mistyped window can be fixed first. */
export const SCHEDULED_NOTICE_GRACE_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const t = createServerT(dictionaries);
const LANGUAGES = Object.keys(dictionaries);
const DEFAULT_LANGUAGE = 'en';

/** What a stage's notice is: its look, where it shows and what it says. */
export interface NoticePlan {
  severity: AnnouncementSeverity;
  channels: AnnouncementChannel[];
  content: Record<string, AnnouncementText>;
  expiresAt: Date | null;
}

type Wording = 'scheduled' | 'reminder' | 'start' | 'unplanned' | 'end' | 'resolved' | 'cancelled';

function formatTime(value: Date | string, lang: string): string {
  try {
    return `${new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value))} UTC`;
  } catch {
    return new Date(value).toISOString();
  }
}

/** The text of a notice in every language the module speaks. */
function wordingOf(wording: Wording, w: MaintenanceWindowView): Record<string, AnnouncementText> {
  return Object.fromEntries(LANGUAGES.map((lang) => {
    const lines: string[] = [];
    if (wording === 'scheduled' || wording === 'reminder' || wording === 'start' || wording === 'unplanned') {
      if (wording === 'unplanned') lines.push(t('announcement.notice.unplanned.body', lang));
      if (wording !== 'unplanned') lines.push(t('announcement.notice.starts', lang, undefined, { time: formatTime(w.scheduledStart, lang) }));
      lines.push(w.scheduledEnd
        ? t('announcement.notice.ends', lang, undefined, { time: formatTime(w.scheduledEnd, lang) })
        : t('announcement.notice.openEnded', lang));
      lines.push(t(w.mode === 'READ_ONLY' ? 'announcement.notice.mode.readOnly' : 'announcement.notice.mode.full', lang));
    } else {
      lines.push(t(`announcement.notice.${wording}.body`, lang));
    }
    const message = w.message?.trim();
    return [lang, {
      title: t(`announcement.notice.${wording}.title`, lang, undefined, { title: w.title }).slice(0, 200),
      body: message ? `${lines.join('\n')}\n\n${message}` : lines.join('\n'),
    }];
  }));
}

/**
 * The notice of `stage` for window `w`. `unplanned`: the window was started by hand. `told`: people already had a notice
 * of this window by mail (a cancellation then goes by mail too).
 */
export function noticeFor(
  stage: MaintenanceStage, w: MaintenanceWindowView, opts: { unplanned?: boolean; cancelled?: boolean; told?: { mail: boolean; started: boolean } } = {},
): NoticePlan {
  const full = w.mode !== 'READ_ONLY';
  const start = new Date(w.scheduledStart);
  switch (stage) {
    case 'scheduled':
      return { severity: 'info', channels: ['banner', 'inapp', 'mail'], content: wordingOf('scheduled', w), expiresAt: start };
    case 'reminder':
      return { severity: 'warning', channels: ['banner', 'toast', 'inapp', ...(full ? ['mail' as const] : [])], content: wordingOf('reminder', w), expiresAt: start };
    case 'start': {
      // A safety expiry a day after the planned end: the end notice expires it, this only covers a lost end event.
      const expiresAt = w.scheduledEnd ? new Date(new Date(w.scheduledEnd).getTime() + DAY_MS) : null;
      return opts.unplanned
        ? { severity: 'critical', channels: ['toast', 'banner', 'inapp', ...(full ? ['mail' as const] : [])], content: wordingOf('unplanned', w), expiresAt }
        : { severity: 'warning', channels: ['banner', 'inapp', ...(full ? ['popup' as const] : [])], content: wordingOf('start', w), expiresAt };
    }
    case 'end': {
      const wording: Wording = opts.cancelled && !opts.told?.started ? 'cancelled' : opts.unplanned ? 'resolved' : 'end';
      return {
        severity: 'info',
        channels: ['toast', 'inapp', ...(opts.cancelled && opts.told?.mail ? ['mail' as const] : [])],
        content: wordingOf(wording, w),
        expiresAt: null,
      };
    }
  }
}

function notices<T>(fn: (repo: Repository<Announcement>) => Promise<T>): Promise<T> {
  return withSystemRLS((qr) => fn(qr.manager.getRepository(Announcement)));
}

const audienceOf = (w: MaintenanceWindowView): AnnouncementAudience => ({
  tenantIds: w.tenantId ? [w.tenantId] : null, roles: [], plans: [], editions: [],
});

/** Creates the window's missing notices of `stages` (one per stage: the unique index keeps a race to one). */
async function ensureNotices(w: MaintenanceWindowView, stages: MaintenanceStage[], now: Date): Promise<void> {
  const rows = stages.flatMap((stage) => {
    if (stage === 'scheduled' && new Date(w.scheduledStart).getTime() <= now.getTime() + 2 * SCHEDULED_NOTICE_GRACE_MS) return [];
    const plan = noticeFor(stage, w);
    return [{
      tenantId: w.tenantId ?? null,
      kind: 'MAINTENANCE',
      status: 'SCHEDULED',
      severity: plan.severity,
      content: plan.content,
      defaultLanguage: DEFAULT_LANGUAGE,
      linkUrl: null,
      audience: audienceOf(w),
      channels: plan.channels,
      sendAt: stage === 'scheduled' ? new Date(now.getTime() + SCHEDULED_NOTICE_GRACE_MS) : null,
      expiresAt: plan.expiresAt,
      windowId: w.windowId,
      stage,
      stats: {},
      createdByUserId: w.createdByUserId ?? null,
    }];
  });
  if (rows.length === 0) return;
  await notices((repo) => repo.createQueryBuilder().insert().into(Announcement).values(rows as never).orIgnore().execute());
}

async function stagesOf(windowId: string): Promise<Map<string, Announcement>> {
  const rows = await notices((repo) => repo.find({ where: { windowId } }));
  return new Map(rows.map((r) => [r.stage ?? '', r]));
}

/** Rewrites a waiting notice the window made, unless a person edited it. */
async function refresh(row: Announcement | undefined, plan: NoticePlan): Promise<void> {
  if (!row || row.edited || row.status !== 'SCHEDULED') return;
  await notices((repo) => repo.update(
    { announcementId: row.announcementId, status: 'SCHEDULED', edited: false },
    { severity: plan.severity, channels: plan.channels, content: plan.content, expiresAt: plan.expiresAt } as never,
  ));
}

async function sendNotice(row: Announcement | undefined): Promise<void> {
  if (!row || row.status !== 'SCHEDULED') return;
  await AnnouncementService.startFanout(row.announcementId, ['SCHEDULED']);
}

async function withdrawWaiting(rows: Map<string, Announcement>, stages: MaintenanceStage[]): Promise<void> {
  const ids = stages.map((s) => rows.get(s)).filter((r): r is Announcement => !!r && r.status === 'SCHEDULED').map((r) => r.announcementId);
  if (ids.length === 0) return;
  await notices((repo) => repo.update({ announcementId: In(ids), status: 'SCHEDULED' }, { status: 'WITHDRAWN', withdrawnAt: new Date() } as never));
}

/**
 * Ends the start notice: its banner and popup stop on every open shell. A start notice whose fan-out gave up (D23) keeps
 * FAILED, so its sender still sees it failed, and only runs out.
 */
async function expireStart(row: Announcement | undefined): Promise<void> {
  if (!row || !['SENT', 'SENDING', 'FAILED'].includes(row.status)) return;
  await notices((repo) => (row.status === 'FAILED'
    ? repo.update({ announcementId: row.announcementId, status: 'FAILED' }, { expiresAt: new Date() } as never)
    : repo.update({ announcementId: row.announcementId, status: In(['SENT', 'SENDING']) }, { status: 'EXPIRED', expiresAt: new Date() } as never)));
  await publishLive(await liveWorkspaces(row));
}

/**
 * Runs out the window's notices of `stages` whose fan-out gave up (D23): the window moved on (a later notice took over,
 * it ended or was cancelled) or was changed, so their text is out of date. They stay FAILED, so their sender still sees
 * it failed, but stop showing on the shells they reached and can no longer be retried (withdraw only).
 */
async function closeFailed(rows: Map<string, Announcement>, stages: MaintenanceStage[]): Promise<void> {
  const failed = stages.map((s) => rows.get(s)).filter((r): r is Announcement => !!r && r.status === 'FAILED');
  if (failed.length === 0) return;
  await notices((repo) => repo.update(
    { announcementId: In(failed.map((r) => r.announcementId)), status: 'FAILED' }, { expiresAt: new Date() } as never,
  ));
  for (const row of failed) await publishLive(await liveWorkspaces(row));
}

/** People were told (a notice whose fan-out gave up may have reached some of them: D23). */
const wasSent = (row: Announcement | undefined) => !!row && ['SENDING', 'SENT', 'EXPIRED', 'FAILED'].includes(row.status);

/** The window started unplanned (forced): its start notice went out critical. */
const startedUnplanned = (rows: Map<string, Announcement>) => wasSent(rows.get('start')) && rows.get('start')?.severity === 'critical';

/** Turns one maintenance event into the window's notices. */
export async function handleMaintenanceEvent(
  event: MaintenanceEventKind, w: MaintenanceWindowView, meta: MaintenanceEventMeta = {}, now = new Date(),
): Promise<void> {
  if (event === 'scheduled') {
    await ensureNotices(w, ['scheduled', 'reminder', 'start', 'end'], now);
    return;
  }
  // A window from before notices existed (or a missed event) gets its notices on its next event.
  await ensureNotices(w, ['reminder', 'start', 'end'], now);
  const rows = await stagesOf(w.windowId);

  switch (event) {
    case 'updated': {
      // An edit during an unplanned outage (an expected end added) keeps its end notice saying "resolved".
      const unplanned = startedUnplanned(rows);
      for (const stage of ['scheduled', 'reminder', 'start', 'end'] as const) await refresh(rows.get(stage), noticeFor(stage, w, { unplanned: stage === 'end' && unplanned }));
      // A failed one ahead of the start may name the old times: retried, it would tell the rest of the workspace those.
      await closeFailed(rows, ['scheduled', 'reminder']);
      return;
    }
    case 'reminder':
      // The reminder supersedes a scheduled notice that has not gone out yet.
      await withdrawWaiting(rows, ['scheduled']);
      await closeFailed(rows, ['scheduled']);
      await refresh(rows.get('reminder'), noticeFor('reminder', w));
      await sendNotice(rows.get('reminder'));
      return;
    case 'started':
      await withdrawWaiting(rows, ['scheduled', 'reminder']);
      await closeFailed(rows, ['scheduled', 'reminder']);
      await refresh(rows.get('start'), noticeFor('start', w, { unplanned: meta.forced }));
      if (meta.forced) await refresh(rows.get('end'), noticeFor('end', w, { unplanned: true }));
      await sendNotice((await stagesOf(w.windowId)).get('start'));
      return;
    case 'ended':
    case 'cancelled': {
      const started = wasSent(rows.get('start'));
      const told = started || wasSent(rows.get('scheduled')) || wasSent(rows.get('reminder'));
      await expireStart(rows.get('start'));
      await withdrawWaiting(rows, ['scheduled', 'reminder', 'start']);
      await closeFailed(rows, ['scheduled', 'reminder']);
      if (!told) {
        // Nobody was told it was coming or running (a window that elapsed while the scheduler was down): no "it is over".
        await withdrawWaiting(rows, ['end']);
        return;
      }
      if (event === 'cancelled') {
        const mail = ['scheduled', 'reminder', 'start'].some((s) => {
          const r = rows.get(s);
          return wasSent(r) && r!.channels.includes('mail') && !r!.stats?.mailCapped;
        });
        const unplanned = startedUnplanned(rows);
        await refresh(rows.get('end'), noticeFor('end', w, { cancelled: true, unplanned, told: { mail, started } }));
      }
      await sendNotice((await stagesOf(w.windowId)).get('end'));
      return;
    }
  }
}

let _registered = false;

/**
 * Boot task (`approval` phase, every process: a window is started by the scheduler in one process and by an operator's
 * request in another). Idempotent.
 */
export async function registerMaintenanceAnnouncements(): Promise<void> {
  if (_registered) return;
  _registered = true;
  const { registerMaintenanceListener } = await import('@kuraykaraaslan-labs/tenant/server/maintenance.events');
  registerMaintenanceListener(async (event, window, meta) => {
    try {
      await handleMaintenanceEvent(event, window, meta);
    } catch (error) {
      Logger.warn(`[announcement] maintenance '${event}' notice for ${window.windowId} failed: ${error}`);
    }
  });
  Logger.info('[announcement] maintenance notices registered');
}
