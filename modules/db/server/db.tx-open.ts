/**
 * db.05: connect + BEGIN, releasing the runner when either fails (the caller's `finally` is not reached yet, so a
 * failed BEGIN used to leak the pooled connection).
 */
export async function openTransaction(qr: import('typeorm').QueryRunner): Promise<void> {
  try {
    await qr.connect();
    await qr.startTransaction();
  } catch (err) {
    await Promise.resolve().then(() => qr.release()).catch(() => undefined);
    throw err;
  }
}

