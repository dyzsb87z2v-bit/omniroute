import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { log } from "./logger.js";

/**
 * In-memory batch state, one entry per chat.
 * States: collecting -> processing -> ready -> (delivered)
 */
const sessions = new Map();

export function getSession(chatId) {
  let session = sessions.get(chatId);
  if (!session) {
    session = {
      chatId,
      state: "collecting",
      items: [], // { fileId, name }
      results: [], // { path, name, bytes }
      failed: [],
      dir: path.join(config.workDir, `chat-${chatId}-${Date.now()}`),
      statusMessageId: null,
      collectTimer: null,
      lastTouched: Date.now(),
    };
    sessions.set(chatId, session);
  }
  session.lastTouched = Date.now();
  return session;
}

export async function ensureDir(session) {
  await fs.mkdir(session.dir, { recursive: true });
  return session.dir;
}

/** Drop a session and delete everything it wrote to disk. */
export async function clearSession(chatId) {
  const session = sessions.get(chatId);
  if (!session) return;
  if (session.collectTimer) clearTimeout(session.collectTimer);
  sessions.delete(chatId);
  try {
    await fs.rm(session.dir, { recursive: true, force: true });
  } catch (err) {
    log.warn(`could not remove ${session.dir}: ${err.message}`);
  }
}

/** Periodically evict abandoned batches so temp files do not pile up. */
export function startSessionReaper() {
  const timer = setInterval(() => {
    const cutoff = Date.now() - config.batch.sessionTtlMs;
    for (const [chatId, session] of sessions) {
      if (session.lastTouched < cutoff && session.state !== "processing") {
        log.info(`reaping idle session for chat ${chatId}`);
        void clearSession(chatId);
      }
    }
  }, 60_000);
  timer.unref();
  return timer;
}
