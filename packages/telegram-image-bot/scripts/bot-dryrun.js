/**
 * End-to-end exercise of the Telegram flow with the Bot API stubbed out.
 * Verifies the full UX: photos -> "N received" -> start -> progress -> done -> ZIP.
 * Usage: node scripts/bot-dryrun.js <sample-dir>
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

process.env.BOT_TOKEN ||= "000000:dryrun-token";
process.env.COLLECT_DEBOUNCE_MS ||= "150";
process.env.PROGRESS_INTERVAL_MS ||= "0";

const { Telegram } = await import("telegraf");
const { createBot } = await import("../src/bot.js");

const sampleDir = process.argv[2];
if (!sampleDir) {
  console.error("usage: node scripts/bot-dryrun.js <sample-dir>");
  process.exit(1);
}
const samples = (await fs.readdir(sampleDir)).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
assert.ok(samples.length > 0, "no sample images found");

const bot = createBot();
const calls = [];
const texts = [];
let nextMessageId = 1000;

// Telegraf builds a fresh Telegram instance per update, so stub at the prototype level.
Telegram.prototype.callApi = async function callApi(method, payload = {}) {
  calls.push({ method, payload });
  if (method === "sendMessage") {
    texts.push(payload.text);
    return { message_id: ++nextMessageId, text: payload.text };
  }
  if (method === "editMessageText") {
    texts.push(payload.text);
    return true;
  }
  if (method === "getFile") {
    const file = samples[Number(payload.file_id.split(":")[1]) % samples.length];
    return { file_id: payload.file_id, file_path: `photos/${file}` };
  }
  if (method === "sendDocument") return { message_id: ++nextMessageId };
  return true;
};

// The downloader fetches the file URL Telegram hands back; serve the sample from disk.
globalThis.fetch = async (url) => {
  const name = path.basename(new URL(String(url)).pathname);
  const data = await fs.readFile(path.join(sampleDir, name));
  return { ok: true, status: 200, arrayBuffer: async () => data };
};

const CHAT = 4242;
let updateId = 1;
const send = (update) => bot.handleUpdate({ update_id: updateId++, ...update });
const photoUpdate = (i) => ({
  message: {
    message_id: 100 + i,
    date: Math.floor(Date.now() / 1000),
    chat: { id: CHAT, type: "private" },
    from: { id: 7, is_bot: false, first_name: "Tester" },
    photo: [
      { file_id: `small:${i}`, width: 90, height: 90 },
      { file_id: `big:${i}`, width: 1600, height: 1200 },
    ],
  },
});
const callback = (data) => ({
  callback_query: {
    id: `cb-${data}-${updateId}`,
    from: { id: 7, is_bot: false, first_name: "Tester" },
    chat_instance: "x",
    data,
    message: {
      message_id: nextMessageId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: CHAT, type: "private" },
    },
  },
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const COUNT = Math.min(6, samples.length);

console.log("\nTelegram flow dry-run\n");

await send({
  message: {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    chat: { id: CHAT, type: "private" },
    from: { id: 7, is_bot: false, first_name: "Tester" },
    text: "/start",
    entities: [{ offset: 0, length: 6, type: "bot_command" }],
  },
});
assert.match(texts.at(-1), /سلام/, "welcome message missing");
console.log("  PASS  /start replies with the welcome text");

for (let i = 0; i < COUNT; i++) await send(photoUpdate(i));
await wait(400);
assert.equal(texts.at(-1), `📸 ${COUNT} عکس دریافت شد`, `unexpected status: ${texts.at(-1)}`);
const prompt = calls.findLast((c) => c.method === "sendMessage" || c.method === "editMessageText");
const buttons = prompt.payload.reply_markup?.inline_keyboard?.flat().map((b) => b.text) ?? [];
assert.ok(buttons.includes("🚀 شروع پردازش"), `missing start button, got ${buttons}`);
console.log(`  PASS  ${COUNT} photos collected into one prompt with the start button`);

await send(callback("run"));
const progress = texts.filter((x) => x.startsWith("🤖 AI Processing:"));
assert.ok(progress.length > 0, "no progress updates emitted");
assert.equal(progress.at(-1), `🤖 AI Processing: ${COUNT}/${COUNT}`, progress.at(-1));
assert.equal(texts.at(-1), `✅ ${COUNT} عکس پردازش شد`, `unexpected final text: ${texts.at(-1)}`);
console.log(`  PASS  progress reported (${progress.length} updates) and batch finished`);

const doneMarkup = calls.findLast((c) => c.method === "editMessageText").payload.reply_markup;
assert.ok(
  doneMarkup?.inline_keyboard?.flat().some((b) => b.text === "📦 دریافت ZIP"),
  "ZIP button missing"
);

await send(callback("zip"));
const docs = calls.filter((c) => c.method === "sendDocument");
assert.equal(docs.length, 1, `expected one ZIP, got ${docs.length}`);
assert.match(docs[0].payload.document.filename ?? "", /\.zip$/);
console.log(`  PASS  ZIP delivered as ${docs[0].payload.document.filename}`);

const { getSession } = await import("../src/session.js");
assert.equal(getSession(CHAT).items.length, 0, "session was not cleared after delivery");
console.log("  PASS  session cleaned up after delivery\n");
console.log("dry-run complete\n");
process.exit(0);
