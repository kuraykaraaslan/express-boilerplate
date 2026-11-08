import { env } from '@kuraykaraaslan-labs/env';
import type { PushPayload } from './notification_push.config';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo accepts at most 100 messages per request. */
export const EXPO_BATCH_SIZE = 100;
const REQUEST_TIMEOUT_MS = 10_000;

/** What happened to one message, in the shape the send service already uses for Web Push. */
export interface ExpoSendResult {
  ok: boolean;
  /** Expo's ticket id for an accepted message; its receipt (later) says whether delivery to APNs/FCM worked. */
  ticketId?: string;
  /** `DeviceNotRegistered` means the token is dead and the row should be pruned. */
  gone?: boolean;
  error?: string;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Map the module's payload onto an Expo message. `url` and `tag` ride in `data`, where the
 * app's notification handler reads them; Expo has no `icon` (the app's own icon is used).
 */
export function toExpoMessage(token: string, payload: PushPayload): Record<string, unknown> {
  return {
    to: token,
    title: payload.title,
    body: payload.body,
    sound: 'default',
    priority: 'high',
    data: { ...(payload.data ?? {}), ...(payload.url ? { url: payload.url } : {}), ...(payload.tag ? { tag: payload.tag } : {}) },
  };
}

/**
 * Send to Expo's push service, one result per token, in order.
 *
 * Fixed destination (no tenant-supplied URL), so there is no SSRF surface. A transport
 * failure or a non-2xx answer marks every message in the batch `ok:false` without `gone`:
 * the tokens are not known to be dead, so nothing is pruned on a bad day at Expo.
 *
 * Only the TICKET is checked here. Expo reports delivery failures (a token that has since
 * unregistered with APNs/FCM) later, in a receipt: the ticket ids of accepted messages are
 * tracked by notification_push.expo-receipts and settled by its sweep.
 */
export async function sendExpo(messages: Array<{ token: string; payload: PushPayload }>): Promise<ExpoSendResult[]> {
  const results: ExpoSendResult[] = [];
  for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
    const batch = messages.slice(i, i + EXPO_BATCH_SIZE);
    results.push(...(await sendBatch(batch)));
  }
  return results;
}

async function sendBatch(batch: Array<{ token: string; payload: PushPayload }>): Promise<ExpoSendResult[]> {
  const failAll = (error: string): ExpoSendResult[] => batch.map(() => ({ ok: false, error }));
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(batch.map((m) => toExpoMessage(m.token, m.payload))),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return failAll(`Expo push service answered ${res.status}`);

    const body = (await res.json()) as { data?: ExpoTicket[] };
    const tickets = body.data ?? [];
    return batch.map((_, idx) => {
      const t = tickets[idx];
      if (!t) return { ok: false, error: 'No ticket returned for this message' };
      if (t.status === 'ok') return { ok: true, ...(t.id ? { ticketId: t.id } : {}) };
      return {
        ok: false,
        gone: t.details?.error === 'DeviceNotRegistered',
        error: t.message ?? t.details?.error ?? 'Expo reported an error',
      };
    });
  } catch (error) {
    return failAll(error instanceof Error ? error.message : String(error));
  }
}
