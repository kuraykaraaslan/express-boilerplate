import { NextRequest, NextResponse } from 'next/server';
import { env } from '@kuraykaraaslan-labs/env';
import Logger from '@kuraykaraaslan-labs/logger';
import { constantTimeEqual } from '@kuraykaraaslan-labs/common/server/cron-auth';
import { settleReceipts } from './notification_push.expo-receipts';

// POST /tenant/[tenantId]/api/cron/expo-receipts
// Protected by Bearer token matching CRON_SECRET. Only meaningful on the root tenant: the pending
// list is platform-wide (each entry carries its own tenant).
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cronSecret = env.CRON_SECRET;
  if (!cronSecret) {
    Logger.warn('[Cron:expo-receipts] CRON_SECRET not configured — endpoint disabled');
    return NextResponse.json({ success: false, message: 'Cron endpoint not configured' }, { status: 503 });
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token || !constantTimeEqual(token, cronSecret)) {
    Logger.warn('[Cron:expo-receipts] Unauthorized attempt');
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await settleReceipts();
    Logger.info(`[Cron:expo-receipts] ${JSON.stringify(result)}`);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    Logger.error(`[Cron:expo-receipts] Failed: ${message}`);
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
