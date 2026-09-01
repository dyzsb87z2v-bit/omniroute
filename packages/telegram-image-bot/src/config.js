import "dotenv/config";
import os from "node:os";
import path from "node:path";

/** Parse an int env var with a fallback. */
function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Parse a float env var with a fallback. */
function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Parse a boolean env var with a fallback. */
function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

export const config = {
  botToken: process.env.BOT_TOKEN?.trim() || "",

  // Output contract
  output: {
    width: int("OUTPUT_WIDTH", 2000),
    height: int("OUTPUT_HEIGHT", 2000),
    quality: int("JPEG_QUALITY", 95),
    format: (process.env.OUTPUT_FORMAT || "jpeg").toLowerCase(),
    // Padding kept around the detected subject, as a fraction of the canvas.
    marginPercent: num("OUTPUT_MARGIN_PERCENT", 3),
    // "auto" = reuse the detected background color, or any sharp-parseable color.
    background: process.env.OUTPUT_BACKGROUND || "auto",
  },

  // Smart detection (heuristic layer — always on, no API key needed)
  detect: {
    // Longest side of the downscaled buffer we analyse. Bigger = slower, not better.
    analysisSize: int("DETECT_ANALYSIS_SIZE", 480),
    // How far a pixel must be from the background color (0-255) to count as content.
    tolerance: num("DETECT_TOLERANCE", 18),
    // Components smaller than this fraction of the main subject are candidates for removal.
    noiseAreaRatio: num("DETECT_NOISE_AREA_RATIO", 0.06),
    // A small component farther than this fraction of the canvas from the subject is dropped
    // (that is where stray captions, numbers and watermarks live).
    detachGapRatio: num("DETECT_DETACH_GAP_RATIO", 0.02),
    // If content covers more than this fraction of the frame there is no real border to trim.
    fullFrameRatio: num("DETECT_FULL_FRAME_RATIO", 0.97),
    // Safety pad (fraction of the crop box) added back around the detected subject.
    safetyPadRatio: num("DETECT_SAFETY_PAD_RATIO", 0.012),
  },

  // Optional AI layer — enabled purely by dropping a key in .env
  ai: {
    enabled: bool("AI_DETECTION_ENABLED", Boolean(process.env.AI_API_KEY?.trim())),
    apiKey: process.env.AI_API_KEY?.trim() || "",
    // Any OpenAI-compatible endpoint works, including a local OmniRoute instance.
    baseUrl: (process.env.AI_BASE_URL || "http://localhost:20128/v1").replace(/\/+$/, ""),
    model: process.env.AI_MODEL || "gpt-4o-mini",
    timeoutMs: int("AI_TIMEOUT_MS", 20000),
    // Longest side of the image sent to the model.
    imageSize: int("AI_IMAGE_SIZE", 768),
  },

  // Batch behaviour
  batch: {
    concurrency: int("PROCESS_CONCURRENCY", 3),
    maxImages: int("MAX_IMAGES_PER_BATCH", 300),
    // Telegram caps bot uploads at 50 MB; stay under it and split into parts.
    maxZipBytes: int("MAX_ZIP_BYTES", 45 * 1024 * 1024),
    // Quiet period after the last photo before the "start" prompt is refreshed.
    collectDebounceMs: int("COLLECT_DEBOUNCE_MS", 900),
    progressIntervalMs: int("PROGRESS_INTERVAL_MS", 1500),
    // Sessions idle for longer than this are dropped with their temp files.
    sessionTtlMs: int("SESSION_TTL_MS", 60 * 60 * 1000),
  },

  workDir: process.env.WORK_DIR || path.join(os.tmpdir(), "telegram-image-bot"),
  logLevel: (process.env.LOG_LEVEL || "info").toLowerCase(),
};

/** Throw with a readable message when the bot cannot possibly start. */
export function assertRunnable() {
  if (!config.botToken) {
    throw new Error(
      "BOT_TOKEN is missing. Copy .env.example to .env and paste the token from @BotFather."
    );
  }
}
