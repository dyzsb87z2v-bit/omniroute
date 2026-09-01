import sharp from "sharp";
import { config } from "./config.js";

/**
 * Heuristic subject detection.
 *
 * The image is analysed at a small resolution, the background colour is estimated from the
 * border ring, and every pixel that differs from it becomes "content". Content pixels are
 * grouped into connected components; the largest one is the subject, and small components
 * that sit detached from it (stray captions, page numbers, watermarks) are discarded before
 * the crop box is computed. The box is therefore guaranteed to contain the whole subject.
 */

/** Median of a numeric array (mutates a copy). */
function median(values) {
  if (values.length === 0) return 0;
  const sorted = Float64Array.from(values).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Estimate the background colour from the outermost `ring` pixels of the raster. */
function estimateBackground(data, width, height, channels, ring = 2) {
  const rs = [];
  const gs = [];
  const bs = [];
  const push = (x, y) => {
    const i = (y * width + x) * channels;
    if (channels === 4 && data[i + 3] < 128) return; // transparent border pixel
    rs.push(data[i]);
    gs.push(data[i + 1]);
    bs.push(data[i + 2]);
  };
  for (let y = 0; y < height; y++) {
    for (let r = 0; r < ring; r++) {
      if (r < width) push(r, y);
      if (width - 1 - r >= 0) push(width - 1 - r, y);
    }
  }
  for (let x = 0; x < width; x++) {
    for (let r = 0; r < ring; r++) {
      if (r < height) push(x, r);
      if (height - 1 - r >= 0) push(x, height - 1 - r);
    }
  }
  // A fully transparent border gives us no colour to sample; white is the sane canvas.
  if (rs.length === 0) return { r: 255, g: 255, b: 255 };
  return { r: median(rs), g: median(gs), b: median(bs) };
}

/** Build a Uint8Array mask where 1 = pixel differs from the background. */
function buildMask(data, width, height, channels, background, tolerance) {
  const mask = new Uint8Array(width * height);
  let count = 0;
  for (let p = 0, i = 0; p < mask.length; p++, i += channels) {
    if (channels === 4 && data[i + 3] < 128) continue; // transparent = background
    const diff = Math.max(
      Math.abs(data[i] - background.r),
      Math.abs(data[i + 1] - background.g),
      Math.abs(data[i + 2] - background.b)
    );
    if (diff > tolerance) {
      mask[p] = 1;
      count++;
    }
  }
  return { mask, count };
}

/** Label 8-connected components of the mask and return their bounding boxes. */
function findComponents(mask, width, height) {
  const labels = new Int32Array(mask.length).fill(-1);
  const stack = new Int32Array(mask.length);
  const components = [];

  for (let seed = 0; seed < mask.length; seed++) {
    if (mask[seed] === 0 || labels[seed] !== -1) continue;
    const id = components.length;
    let top = 0;
    stack[top++] = seed;
    labels[seed] = id;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    while (top > 0) {
      const p = stack[--top];
      const x = p % width;
      const y = (p - x) / width;
      area++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const np = ny * width + nx;
          if (mask[np] === 1 && labels[np] === -1) {
            labels[np] = id;
            stack[top++] = np;
          }
        }
      }
    }
    components.push({ id, area, minX, minY, maxX, maxY });
  }
  return components;
}

/** Chebyshev gap between two boxes; 0 when they touch or overlap. */
function boxGap(a, b) {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  return Math.max(dx, dy);
}

function unionBox(boxes) {
  return boxes.reduce(
    (acc, b) => ({
      minX: Math.min(acc.minX, b.minX),
      minY: Math.min(acc.minY, b.minY),
      maxX: Math.max(acc.maxX, b.maxX),
      maxY: Math.max(acc.maxY, b.maxY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
}

/** Scale an analysis-space box back to original pixel coordinates. */
function toOriginal(box, scaleX, scaleY, size) {
  const left = Math.max(0, Math.floor(box.minX * scaleX));
  const top = Math.max(0, Math.floor(box.minY * scaleY));
  const right = Math.min(size.width, Math.ceil((box.maxX + 1) * scaleX));
  const bottom = Math.min(size.height, Math.ceil((box.maxY + 1) * scaleY));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/**
 * @param {Buffer} buffer source image bytes
 * @param {{width:number,height:number}} size original pixel dimensions
 * @returns {Promise<{box:{left:number,top:number,width:number,height:number},
 *   background:{r:number,g:number,b:number}, reason:string, stats:object}>}
 */
export async function detectSubject(buffer, size) {
  const d = config.detect;
  const fullFrame = { left: 0, top: 0, width: size.width, height: size.height };

  const { data, info } = await sharp(buffer, { failOn: "none" })
    .rotate()
    .resize(d.analysisSize, d.analysisSize, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const background = estimateBackground(data, width, height, channels);
  const { mask, count } = buildMask(data, width, height, channels, background, d.tolerance);
  const total = width * height;
  const contentRatio = count / total;

  const base = {
    background,
    mainBox: fullFrame,
    stats: { contentRatio, components: 0, dropped: 0 },
  };
  if (count === 0) return { ...base, box: fullFrame, reason: "blank" };
  if (contentRatio >= d.fullFrameRatio) return { ...base, box: fullFrame, reason: "full-frame" };

  const components = findComponents(mask, width, height);
  components.sort((a, b) => b.area - a.area);
  const main = components[0];

  // Keep the subject, anything comparably large, and anything adjacent to what we already
  // keep. Repeat until stable so multi-part subjects are not split apart.
  const gapLimit = d.detachGapRatio * Math.max(width, height);
  const kept = [main];
  const keptIds = new Set([main.id]);
  let changed = true;
  while (changed) {
    changed = false;
    const current = unionBox(kept);
    for (const comp of components) {
      if (keptIds.has(comp.id)) continue;
      const bigEnough = comp.area >= main.area * d.noiseAreaRatio;
      const adjacent = boxGap(comp, current) <= gapLimit;
      if (bigEnough || adjacent) {
        kept.push(comp);
        keptIds.add(comp.id);
        changed = true;
      }
    }
  }

  const box = unionBox(kept);
  const pad = Math.ceil(
    d.safetyPadRatio * Math.max(box.maxX - box.minX + 1, box.maxY - box.minY + 1)
  );
  const scaleX = size.width / width;
  const scaleY = size.height / height;

  const left = Math.max(0, Math.floor((box.minX - pad) * scaleX));
  const top = Math.max(0, Math.floor((box.minY - pad) * scaleY));
  const right = Math.min(size.width, Math.ceil((box.maxX + 1 + pad) * scaleX));
  const bottom = Math.min(size.height, Math.ceil((box.maxY + 1 + pad) * scaleY));

  const cropped = {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };

  return {
    box: cropped,
    // The largest component alone: the AI layer may shrink the crop, but never past this.
    mainBox: toOriginal(main, scaleX, scaleY, size),
    background,
    reason: components.length === kept.length ? "trim" : "trim+cleanup",
    stats: {
      contentRatio,
      components: components.length,
      dropped: components.length - kept.length,
    },
  };
}
