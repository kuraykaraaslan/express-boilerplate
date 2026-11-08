import 'reflect-metadata';
import { createQueue, createWorker } from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import AnnouncementService from './announcement.service';

/**
 * The announcement queue: one `fanout` job per send (its id is the announcement's, so a second enqueue of a running one
 * is a no-op) and one `recall` job per withdrawal of a sent one; plus the minutely `tick` (scheduled ones due, expiries,
 * lost or failed fan-outs, `requeueFanout`, and the ones given up after `FANOUT_MAX_RESTARTS`: D23).
 *
 *  - `startAnnouncementWorker` (boot task, `consumer`): the worker, in every process that runs consumers.
 *  - `scheduleAnnouncementTickJob` (boot task, `scheduler`): the repeatable tick, on the scheduler leader.
 */
const QUEUE_NAME = 'announcement';

type AnnouncementJob = { announcementId?: string };

let _queue: ReturnType<typeof createQueue<AnnouncementJob>> | null = null;
let _worker: ReturnType<typeof createWorker<AnnouncementJob>> | null = null;
let _scheduled = false;

function queue() {
  return (_queue ??= createQueue<AnnouncementJob>(QUEUE_NAME));
}

export async function enqueueFanout(announcementId: string): Promise<void> {
  await queue().add('fanout', { announcementId }, {
    jobId: `fanout-${announcementId}`, attempts: 5, backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 100, removeOnFail: 200,
  });
}

/**
 * The fan-out job BullMQ still keeps for an announcement: its state, and the last error of one that failed all its
 * attempts (what the tick records when it gives the fan-out up, D23). null when none is kept (lost, or removed).
 */
export async function fanoutJobState(announcementId: string): Promise<{ state: string; failedReason: string | null } | null> {
  const job = await queue().getJob(`fanout-${announcementId}`);
  if (!job) return null;
  return { state: await job.getState(), failedReason: job.failedReason || null };
}

/**
 * Queues a stalled fan-out again (the tick, or a retry of a FAILED one). Its fixed job id makes an add a no-op while BullMQ still keeps the old job, so
 * one that gave up (failed after its attempts, kept by `removeOnFail`) or ended is removed first; one still waiting,
 * delayed or running is left be. True when a job was queued.
 */
export async function requeueFanout(announcementId: string): Promise<boolean> {
  const job = await queue().getJob(`fanout-${announcementId}`);
  if (job) {
    const state = await job.getState();
    if (state !== 'failed' && state !== 'completed') return false;
    await job.remove();
  }
  await enqueueFanout(announcementId);
  return true;
}

export async function enqueueRecall(announcementId: string): Promise<void> {
  await queue().add('recall', { announcementId }, {
    jobId: `recall-${announcementId}`, attempts: 5, backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 100, removeOnFail: 200,
  });
}

export function startAnnouncementWorker() {
  if (_worker) return _worker;
  _worker = createWorker<AnnouncementJob>(QUEUE_NAME, async (job) => {
    if (job.name === 'fanout' && job.data.announcementId) {
      const r = await AnnouncementService.runFanout(job.data.announcementId);
      Logger.info(`[announcement] ${job.data.announcementId} sent to ${r.recipients} people`);
      return r;
    }
    if (job.name === 'recall' && job.data.announcementId) return AnnouncementService.runRecall(job.data.announcementId);
    if (job.name === 'tick') {
      const r = await AnnouncementService.tick();
      if (r.started || r.expired || r.requeued || r.failed) {
        Logger.info(`[CronJob:announcement] started=${r.started} expired=${r.expired} requeued=${r.requeued} failed=${r.failed}`);
      }
      return r;
    }
    return null;
  }, { concurrency: 2 });
  _worker.on('failed', (job, err) => Logger.error(`[announcement] job ${job?.name}:${job?.id} failed: ${err.message}`));
  return _worker;
}

export async function scheduleAnnouncementTickJob(cronPattern = '* * * * *'): Promise<void> {
  if (_scheduled) return;
  _scheduled = true;
  await queue().add('tick', {}, {
    repeat: { pattern: cronPattern }, jobId: 'announcement-tick-recurring',
    removeOnComplete: 20, removeOnFail: 50,
  });
  Logger.info(`[CronJob:announcement] Scheduled with pattern: ${cronPattern}`);
}
