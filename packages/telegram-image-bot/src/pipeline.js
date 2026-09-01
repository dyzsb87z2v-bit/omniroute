import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { processImage, outputExtension } from "./process.js";
import { ensureDir } from "./session.js";
import { log } from "./logger.js";

/** Download a Telegram file into memory. */
async function download(telegram, fileId) {
  const link = await telegram.getFileLink(fileId);
  const res = await fetch(link.href ?? link, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`download failed with HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Download + process every queued item with a bounded worker pool, writing results to the
 * session directory. `onProgress` is called after each finished item.
 *
 * @returns {Promise<{results:Array, failed:Array}>}
 */
export async function runBatch(session, telegram, onProgress) {
  const dir = await ensureDir(session);
  const ext = outputExtension();
  const results = new Array(session.items.length).fill(null);
  const failed = [];
  const pad = String(session.items.length).length;

  let cursor = 0;
  let done = 0;

  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= session.items.length) return;
      const item = session.items[index];
      try {
        const input = await download(telegram, item.fileId);
        const { buffer, info } = await processImage(input);
        const name = `${String(index + 1).padStart(pad, "0")}_${item.name}.${ext}`;
        const outPath = path.join(dir, name);
        await fs.writeFile(outPath, buffer);
        results[index] = { path: outPath, name, bytes: buffer.length, info };
      } catch (err) {
        log.warn(`image ${index + 1} failed: ${err.message}`);
        failed.push({ index: index + 1, reason: err.message });
      } finally {
        done++;
        onProgress?.(done, session.items.length);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(config.batch.concurrency, session.items.length) },
    worker
  );
  await Promise.all(workers);

  return { results: results.filter(Boolean), failed };
}
