import sharp from "sharp";
import { config } from "./config.js";
import { detectSubject } from "./detect.js";
import { detectSubjectWithAi } from "./ai.js";
import { log } from "./logger.js";

/** Union of two boxes, so a refinement can never cut away the subject. */
function unionBoxes(a, b) {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  const right = Math.max(a.left + a.width, b.left + b.width);
  const bottom = Math.max(a.top + a.height, b.top + b.height);
  return { left, top, width: right - left, height: bottom - top };
}

function clampBox(box, size) {
  const left = Math.max(0, Math.min(Math.round(box.left), size.width - 1));
  const top = Math.max(0, Math.min(Math.round(box.top), size.height - 1));
  return {
    left,
    top,
    width: Math.max(1, Math.min(Math.round(box.width), size.width - left)),
    height: Math.max(1, Math.min(Math.round(box.height), size.height - top)),
  };
}

function toCss({ r, g, b }) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return { r: c(r), g: c(g), b: c(b), alpha: 1 };
}

/** Encode according to OUTPUT_FORMAT, defaulting to JPEG at the configured quality. */
function encode(pipeline) {
  const { format, quality } = config.output;
  if (format === "png") return pipeline.png({ compressionLevel: 9 });
  if (format === "webp") return pipeline.webp({ quality, effort: 5 });
  return pipeline.jpeg({
    quality,
    chromaSubsampling: "4:4:4", // no colour subsampling — keeps edges and text crisp
    mozjpeg: true,
  });
}

/**
 * Detect the subject, crop away borders/stray text, and render onto a fixed-size canvas.
 * The subject keeps its aspect ratio (letterboxed, never stretched, never cropped).
 *
 * @param {Buffer} input original image bytes
 * @returns {Promise<{buffer:Buffer, info:object}>}
 */
export async function processImage(input) {
  const meta = await sharp(input, { failOn: "none" }).metadata();
  const oriented = meta.autoOrient ?? { width: meta.width, height: meta.height };
  const size = { width: oriented.width, height: oriented.height };
  if (!size.width || !size.height) throw new Error("unsupported or corrupt image");

  const detection = await detectSubject(input, size);
  let box = detection.box;
  let source = "heuristic";

  if (config.ai.enabled) {
    try {
      const aiBox = await detectSubjectWithAi(input, size);
      if (aiBox) {
        // Trust the AI to tighten the crop, but never past the detected subject itself.
        box = clampBox(unionBoxes(aiBox, detection.mainBox), size);
        source = "ai";
      }
    } catch (err) {
      log.warn(`AI detection failed (${err.message}); using heuristic box`);
    }
  }

  const background =
    config.output.background === "auto" ? toCss(detection.background) : config.output.background;

  const { width: outW, height: outH, marginPercent } = config.output;
  const marginX = Math.round((outW * marginPercent) / 100);
  const marginY = Math.round((outH * marginPercent) / 100);
  const innerW = Math.max(1, outW - marginX * 2);
  const innerH = Math.max(1, outH - marginY * 2);

  const pipeline = sharp(input, { failOn: "none" })
    .rotate() // apply EXIF orientation before anything else
    .extract(box)
    .flatten({ background })
    .resize(innerW, innerH, {
      fit: "contain", // letterbox: aspect ratio preserved, no stretching
      position: "centre",
      kernel: "lanczos3",
      background,
    })
    .extend({
      top: marginY,
      bottom: marginY,
      left: marginX,
      right: marginX,
      background,
    });

  const { data, info } = await encode(pipeline).toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    info: {
      source,
      reason: detection.reason,
      original: size,
      crop: box,
      output: { width: info.width, height: info.height },
      droppedComponents: detection.stats.dropped,
      bytes: data.length,
    },
  };
}

/** File extension matching the configured output format. */
export function outputExtension() {
  const { format } = config.output;
  if (format === "png") return "png";
  if (format === "webp") return "webp";
  return "jpg";
}
