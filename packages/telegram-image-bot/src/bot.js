import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import { config } from "./config.js";
import { getSession, clearSession, startSessionReaper, ensureDir } from "./session.js";
import { runBatch } from "./pipeline.js";
import { createZipParts } from "./zip.js";
import { telegramAgent } from "./http.js";
import { log } from "./logger.js";

const IMAGE_MIME = /^image\/(jpeg|png|webp|heic|heif|tiff|bmp|avif)$/i;

const t = {
  welcome: [
    "👋 سلام!",
    "",
    "عکس‌هایت را بفرست (چندتایی هم مشکلی نیست).",
    "من برای هر عکس سوژه اصلی را تشخیص می‌دهم، حاشیه و نوشته‌های اضافه را حذف می‌کنم،",
    `همه را به اندازه یکسان ${config.output.width}×${config.output.height} می‌برم`,
    `(کیفیت ${config.output.quality}، بدون کشیدگی) و خروجی را در یک ZIP تحویل می‌دهم.`,
    "",
    "💡 برای بالاترین کیفیت، عکس‌ها را به‌صورت «فایل» بفرست — تلگرام عکس معمولی را فشرده می‌کند.",
    "",
    "دستورها: /reset پاک کردن صف • /status وضعیت • /help راهنما",
  ].join("\n"),
  received: (n) => `📸 ${n} عکس دریافت شد`,
  startButton: "🚀 شروع پردازش",
  zipButton: "📦 دریافت ZIP",
  resetButton: "🗑 پاک کردن",
  progress: (done, total) => `🤖 AI Processing: ${done}/${total}`,
  finished: (n) => `✅ ${n} عکس پردازش شد`,
  empty: "هنوز عکسی نفرستادی. اول عکس‌ها را بفرست.",
  busy: "⏳ پردازش در حال انجام است، لطفاً صبر کن.",
  zipping: "📦 در حال ساخت ZIP…",
  cleared: "🗑 صف پاک شد.",
  tooMany: (max) => `صف پر است (حداکثر ${max} عکس). با /reset دوباره شروع کن.`,
  unsupported: "این فایل تصویر نیست. عکس یا فایل تصویری بفرست.",
};

const startKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback(t.startButton, "run")],
  [Markup.button.callback(t.resetButton, "reset")],
]);
const zipKeyboard = Markup.inlineKeyboard([[Markup.button.callback(t.zipButton, "zip")]]);

/** Edit the status message in place, or send a fresh one if editing is impossible. */
async function setStatus(ctx, session, text, keyboard) {
  const extra = keyboard ? { ...keyboard } : {};
  try {
    if (session.statusMessageId) {
      await ctx.telegram.editMessageText(
        session.chatId,
        session.statusMessageId,
        undefined,
        text,
        extra
      );
      return;
    }
  } catch (err) {
    // "message is not modified" is expected while the count is unchanged.
    if (!/not modified/i.test(err.description ?? err.message ?? "")) {
      session.statusMessageId = null;
    } else {
      return;
    }
  }
  const sent = await ctx.telegram.sendMessage(session.chatId, text, extra);
  session.statusMessageId = sent.message_id;
}

/** Queue one incoming image and refresh the "N received" prompt after a short quiet period. */
function enqueue(ctx, session, fileId, name) {
  session.items.push({ fileId, name });
  if (session.collectTimer) clearTimeout(session.collectTimer);
  session.collectTimer = setTimeout(() => {
    session.collectTimer = null;
    setStatus(ctx, session, t.received(session.items.length), startKeyboard).catch((err) =>
      log.warn(`status update failed: ${err.message}`)
    );
  }, config.batch.collectDebounceMs);
}

export function createBot() {
  const bot = new Telegraf(config.botToken, {
    handlerTimeout: 15 * 60 * 1000,
    telegram: telegramAgent ? { agent: telegramAgent } : undefined,
  });

  bot.start(async (ctx) => {
    await clearSession(ctx.chat.id);
    await ctx.reply(t.welcome);
  });

  bot.help((ctx) => ctx.reply(t.welcome));

  bot.command("reset", async (ctx) => {
    await clearSession(ctx.chat.id);
    await ctx.reply(t.cleared);
  });

  bot.command("status", (ctx) => {
    const session = getSession(ctx.chat.id);
    return ctx.reply(
      `وضعیت: ${session.state} • در صف: ${session.items.length} • آماده: ${session.results.length}`
    );
  });

  bot.on(message("photo"), async (ctx) => {
    const session = getSession(ctx.chat.id);
    if (session.state === "processing") return ctx.reply(t.busy);
    if (session.state !== "collecting") {
      await clearSession(ctx.chat.id);
      return ctx.reply("صف قبلی بسته شد. عکس‌ها را دوباره بفرست.");
    }
    if (session.items.length >= config.batch.maxImages) {
      return ctx.reply(t.tooMany(config.batch.maxImages));
    }
    // The last entry is always the highest resolution Telegram kept.
    const photo = ctx.message.photo.at(-1);
    enqueue(ctx, session, photo.file_id, `photo_${ctx.message.message_id}`);
  });

  bot.on(message("document"), async (ctx) => {
    const doc = ctx.message.document;
    if (!IMAGE_MIME.test(doc.mime_type ?? "")) return ctx.reply(t.unsupported);
    const session = getSession(ctx.chat.id);
    if (session.state === "processing") return ctx.reply(t.busy);
    if (session.items.length >= config.batch.maxImages) {
      return ctx.reply(t.tooMany(config.batch.maxImages));
    }
    const base = (doc.file_name ?? `file_${ctx.message.message_id}`).replace(/\.[^.]+$/, "");
    enqueue(ctx, session, doc.file_id, base.replace(/[^\w.-]+/g, "_").slice(0, 60));
  });

  bot.action("reset", async (ctx) => {
    await ctx.answerCbQuery();
    await clearSession(ctx.chat.id);
    await ctx.editMessageText(t.cleared).catch(() => {});
  });

  bot.action("run", async (ctx) => {
    const session = getSession(ctx.chat.id);
    await ctx.answerCbQuery();
    if (session.state === "processing") return;
    if (session.items.length === 0) return ctx.reply(t.empty);

    session.state = "processing";
    if (session.collectTimer) {
      clearTimeout(session.collectTimer);
      session.collectTimer = null;
    }

    const total = session.items.length;
    await setStatus(ctx, session, t.progress(0, total));

    let lastEdit = 0;
    const onProgress = (done) => {
      const now = Date.now();
      if (done < total && now - lastEdit < config.batch.progressIntervalMs) return;
      lastEdit = now;
      setStatus(ctx, session, t.progress(done, total)).catch(() => {});
    };

    try {
      const { results, failed } = await runBatch(session, ctx.telegram, onProgress);
      session.results = results;
      session.failed = failed;
      session.state = "ready";

      let text = t.finished(results.length);
      if (failed.length > 0) text += `\n⚠️ ${failed.length} عکس پردازش نشد`;
      await setStatus(ctx, session, text, zipKeyboard);
    } catch (err) {
      log.error(`batch failed for chat ${ctx.chat.id}:`, err);
      session.state = "collecting";
      await setStatus(ctx, session, `❌ خطا در پردازش: ${err.message}`, startKeyboard);
    }
  });

  bot.action("zip", async (ctx) => {
    const session = getSession(ctx.chat.id);
    await ctx.answerCbQuery();
    if (session.results.length === 0) return ctx.reply(t.empty);
    if (session.state === "zipping") return;

    session.state = "zipping";
    await setStatus(ctx, session, t.zipping);

    try {
      const dir = await ensureDir(session);
      const parts = await createZipParts(session.results, dir, "processed");
      for (const part of parts) {
        await ctx.replyWithDocument(
          { source: part.path, filename: part.name },
          { caption: `📦 ${part.name} — ${part.count} عکس` }
        );
      }
      await setStatus(ctx, session, t.finished(session.results.length));
      await clearSession(ctx.chat.id);
    } catch (err) {
      log.error(`zip failed for chat ${ctx.chat.id}:`, err);
      session.state = "ready";
      await setStatus(ctx, session, `❌ ساخت ZIP ناموفق بود: ${err.message}`, zipKeyboard);
    }
  });

  bot.catch((err, ctx) => {
    log.error(`unhandled error for update ${ctx.update?.update_id}:`, err);
  });

  startSessionReaper();
  return bot;
}
