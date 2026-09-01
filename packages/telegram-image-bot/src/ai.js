import sharp from "sharp";
import { config } from "./config.js";
import { log } from "./logger.js";

/**
 * Optional AI refinement layer.
 *
 * Disabled unless AI_API_KEY is present in .env. It talks to any OpenAI-compatible
 * `/chat/completions` endpoint (OpenAI, OpenRouter, a local OmniRoute instance, ...) and asks a
 * vision model for the normalised bounding box of the real subject, explicitly excluding
 * captions, numbers and watermarks. The heuristic layer stays in charge of the safety floor:
 * the caller never lets the AI box cut into the detected subject.
 */

const PROMPT = [
  "You are a precise image-cropping assistant.",
  "Find the bounding box of the MAIN SUBJECT of this image.",
  "Exclude: empty margins, background padding, captions, labels, numbers, watermarks,",
  "logos and any text that is not part of the subject itself.",
  "Never cut off any part of the subject: when unsure, make the box slightly larger.",
  'Answer with JSON only, no prose: {"x":0.0,"y":0.0,"w":1.0,"h":1.0,"confidence":0.0}',
  "where x/y are the top-left corner and w/h the size, all as fractions of the image (0-1).",
].join(" ");

/** Pull the first JSON object out of a model reply that may be fenced or chatty. */
function parseBox(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const x = Number(parsed.x);
  const y = Number(parsed.y);
  const w = Number(parsed.w);
  const h = Number(parsed.h);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  if (w <= 0 || h <= 0) return null;
  return {
    x: Math.min(Math.max(x, 0), 1),
    y: Math.min(Math.max(y, 0), 1),
    w: Math.min(w, 1),
    h: Math.min(h, 1),
    confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0.5,
  };
}

/**
 * @param {Buffer} buffer original image bytes
 * @param {{width:number,height:number}} size original dimensions
 * @returns {Promise<null|{left:number,top:number,width:number,height:number,confidence:number}>}
 */
export async function detectSubjectWithAi(buffer, size) {
  if (!config.ai.enabled || !config.ai.apiKey) return null;

  const preview = await sharp(buffer, { failOn: "none" })
    .rotate()
    .resize(config.ai.imageSize, config.ai.imageSize, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  const body = {
    model: config.ai.model,
    temperature: 0,
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${preview.toString("base64")}` },
          },
        ],
      },
    ],
  };

  const res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.ai.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.ai.timeoutMs),
  });

  if (!res.ok) {
    log.warn(`AI detection HTTP ${res.status}; falling back to heuristic`);
    return null;
  }

  const json = await res.json();
  const box = parseBox(json?.choices?.[0]?.message?.content);
  if (!box) {
    log.warn("AI detection returned no usable box; falling back to heuristic");
    return null;
  }

  // A box covering (almost) everything adds nothing; a microscopic one is a hallucination.
  const area = box.w * box.h;
  if (area >= 0.985 || area < 0.02) return null;

  const left = Math.round(box.x * size.width);
  const top = Math.round(box.y * size.height);
  return {
    left: Math.max(0, Math.min(left, size.width - 1)),
    top: Math.max(0, Math.min(top, size.height - 1)),
    width: Math.max(1, Math.min(Math.round(box.w * size.width), size.width - left)),
    height: Math.max(1, Math.min(Math.round(box.h * size.height), size.height - top)),
    confidence: box.confidence,
  };
}
