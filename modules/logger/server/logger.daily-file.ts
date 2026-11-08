import { Writable } from 'node:stream';
import { createWriteStream, mkdirSync, readdirSync, unlinkSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';

/**
 * A writable that appends to `<dir>/<YYYY-MM-DD>.log` and moves to the next file when the (UTC) day changes.
 *
 * winston's File transport takes a fixed filename. The logger used to compute `logs/<date>.log` once at module load, so a
 * process that stayed up past midnight kept writing yesterday's file for as long as it lived. The date is resolved per
 * write here, and the previous day's handle is closed when the day rolls.
 *
 * 38-security 5.6: the daily files used to grow forever. When a file is opened (the first write, and every day roll) the files in `dir`
 * named `<YYYY-MM-DD>.log` that are more than `retentionDays` old are deleted; `0` keeps everything. Only files of that exact shape are ever
 * touched, so nothing else in the directory can be removed.
 *
 * Logging must never take the caller down: a directory or file that cannot be opened or written (read-only filesystem, full disk)
 * writes the line to stderr instead and tries again on the next write.
 */
export class DailyFileStream extends Writable {
  private current: { day: string; stream: WriteStream } | null = null;

  constructor(
    private readonly dir: string = 'logs',
    private readonly now: () => Date = () => new Date(),
    private readonly retentionDays: number = 0,
  ) {
    super({ decodeStrings: false });
  }

  /** The file a write at `date` goes to. */
  fileFor(date: Date): string {
    return join(this.dir, `${date.toISOString().split('T')[0]}.log`);
  }

  private open(date: Date): WriteStream | null {
    const day = date.toISOString().split('T')[0];
    if (this.current?.day === day) return this.current.stream;
    this.current?.stream.end();
    this.current = null;
    try {
      mkdirSync(this.dir, { recursive: true });
      const stream = createWriteStream(this.fileFor(date), { flags: 'a' });
      // An asynchronous failure (disk full, file removed) must not become an uncaught 'error' event.
      stream.on('error', () => {
        if (this.current?.stream === stream) this.current = null;
      });
      this.current = { day, stream };
      this.prune(date);
      return stream;
    } catch {
      return null;
    }
  }

  /** Deletes expired `<date>.log` files. Best effort: a failure to list or delete never reaches the writer. */
  private prune(date: Date): void {
    if (!(this.retentionDays > 0)) return;
    const cutoff = date.getTime() - this.retentionDays * 86_400_000;
    try {
      for (const name of readdirSync(this.dir)) {
        const m = /^(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
        if (!m) continue;
        const at = Date.parse(`${m[1]}T00:00:00Z`);
        if (Number.isFinite(at) && at < cutoff) {
          try { unlinkSync(join(this.dir, name)); } catch { /* in use or already gone */ }
        }
      }
    } catch {
      /* unreadable directory: keep everything */
    }
  }

  override _write(chunk: string | Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    const stream = this.open(this.now());
    if (!stream) {
      process.stderr.write(chunk);
      callback();
      return;
    }
    // The open itself is asynchronous: a file that cannot be created (read-only filesystem with an existing logs/, a
    // directory in its place, a full disk) fails here, not in `open`. The line goes to stderr rather than being lost.
    stream.write(chunk, (err) => {
      if (err) process.stderr.write(chunk);
      callback();
    });
  }

  override _final(callback: (error?: Error | null) => void): void {
    const stream = this.current?.stream;
    this.current = null;
    if (!stream) return callback();
    stream.end(() => callback());
  }
}
