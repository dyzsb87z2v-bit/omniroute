/**
 * End-to-end check of the detection + rendering pipeline on synthetic images.
 * Run with: npm run selftest
 */
import assert from "node:assert/strict";
import sharp from "sharp";
import { detectSubject } from "../src/detect.js";
import { processImage } from "../src/process.js";
import { config } from "../src/config.js";

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}

/** Canvas with a coloured subject rectangle and optional stray text blocks. */
function makeImage({ w, h, bg = "#ffffff", subject, extras = [], format = "jpeg" }) {
  const rects = [subject, ...extras]
    .map(
      (r) =>
        `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.fill ?? "#c0392b"}"/>`
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="${bg}"/>${rects}</svg>`;
  const pipe = sharp(Buffer.from(svg));
  return format === "png" ? pipe.png().toBuffer() : pipe.jpeg({ quality: 98 }).toBuffer();
}

console.log("\nSmart-crop self test\n");

await test("crops uniform borders down to the subject", async () => {
  const subject = { x: 400, y: 300, w: 400, h: 300 };
  const buf = await makeImage({ w: 1200, h: 900, subject });
  const { box } = await detectSubject(buf, { width: 1200, height: 900 });
  assert.ok(
    box.left <= subject.x && box.top <= subject.y,
    `box starts too late: ${JSON.stringify(box)}`
  );
  assert.ok(box.left > 350, "border was not trimmed on the left");
  assert.ok(box.top > 250, "border was not trimmed on the top");
  assert.ok(box.left + box.width >= subject.x + subject.w, "subject cut on the right");
  assert.ok(box.top + box.height >= subject.y + subject.h, "subject cut at the bottom");
});

await test("drops detached captions and numbers", async () => {
  const subject = { x: 400, y: 200, w: 400, h: 400 };
  const extras = [
    { x: 60, y: 840, w: 220, h: 24, fill: "#111111" }, // caption line, bottom-left
    { x: 1120, y: 40, w: 40, h: 22, fill: "#111111" }, // page number, top-right
  ];
  const buf = await makeImage({ w: 1200, h: 900, subject, extras });
  const det = await detectSubject(buf, { width: 1200, height: 900 });
  assert.equal(det.stats.dropped, 2, `expected 2 stray blocks dropped, got ${det.stats.dropped}`);
  assert.ok(det.box.top + det.box.height < 840, "caption still inside the crop");
  assert.ok(det.box.left > 280, "page number still inside the crop");
  assert.ok(det.box.left <= subject.x && det.box.top <= subject.y, "subject cut");
});

await test("keeps a full-bleed image untouched", async () => {
  const buf = await makeImage({ w: 800, h: 600, subject: { x: 0, y: 0, w: 800, h: 600 } });
  const det = await detectSubject(buf, { width: 800, height: 600 });
  assert.equal(det.box.width, 800);
  assert.equal(det.box.height, 600);
});

await test("handles transparent PNG padding", async () => {
  const subject = await sharp({
    create: { width: 300, height: 200, channels: 4, background: "#2980b9" },
  })
    .png()
    .toBuffer();
  const buf = await sharp({
    create: { width: 1000, height: 1000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: subject, left: 350, top: 400 }])
    .png()
    .toBuffer();
  const det = await detectSubject(buf, { width: 1000, height: 1000 });
  assert.ok(det.box.left > 300 && det.box.left <= 350, `left=${det.box.left}`);
  assert.ok(det.box.width < 400, `width=${det.box.width}`);
});

await test("renders an exact 2000x2000 canvas without stretching", async () => {
  const subject = { x: 300, y: 250, w: 600, h: 300 }; // 2:1 subject
  const buf = await makeImage({ w: 1200, h: 900, subject });
  const { buffer, info } = await processImage(buf);
  const meta = await sharp(buffer).metadata();
  assert.equal(meta.width, config.output.width);
  assert.equal(meta.height, config.output.height);
  assert.equal(meta.format, "jpeg");

  // The rendered subject must keep the crop's aspect ratio (no stretch).
  const out = await detectSubject(buffer, { width: meta.width, height: meta.height });
  const cropAspect = info.crop.width / info.crop.height;
  const drawnAspect = out.box.width / out.box.height;
  assert.ok(
    Math.abs(cropAspect - drawnAspect) / cropAspect < 0.03,
    `aspect changed: crop=${cropAspect.toFixed(3)} drawn=${drawnAspect.toFixed(3)}`
  );

  // The configured margin must be respected on every side.
  const margin = (config.output.width * config.output.marginPercent) / 100;
  assert.ok(out.box.left >= margin - 2, `left margin too small: ${out.box.left}`);
  assert.ok(
    config.output.width - (out.box.left + out.box.width) >= margin - 2,
    "right margin too small"
  );
});

await test("all outputs share the same dimensions", async () => {
  const inputs = await Promise.all([
    makeImage({ w: 1200, h: 900, subject: { x: 100, y: 100, w: 500, h: 200 } }),
    makeImage({ w: 640, h: 1400, subject: { x: 50, y: 700, w: 300, h: 400 } }),
    makeImage({ w: 3000, h: 1000, subject: { x: 1200, y: 100, w: 400, h: 800 } }),
  ]);
  const metas = [];
  for (const buf of inputs) {
    const { buffer } = await processImage(buf);
    metas.push(await sharp(buffer).metadata());
  }
  for (const m of metas) {
    assert.equal(m.width, config.output.width);
    assert.equal(m.height, config.output.height);
  }
});

await test("respects EXIF orientation", async () => {
  const subject = { x: 100, y: 100, w: 400, h: 200 };
  const flat = await makeImage({ w: 1200, h: 600, subject });
  const rotated = await sharp(flat).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const { buffer, info } = await processImage(rotated);
  assert.equal(info.original.width, 600, "auto-orient did not swap dimensions");
  assert.equal(info.original.height, 1200);
  const meta = await sharp(buffer).metadata();
  assert.equal(meta.width, config.output.width);
  assert.equal(meta.height, config.output.height);
});

await test("falls back to a white canvas for fully transparent padding", async () => {
  const subject = await sharp({
    create: { width: 400, height: 200, channels: 4, background: "#8e44ad" },
  })
    .png()
    .toBuffer();
  const buf = await sharp({
    create: { width: 1600, height: 1600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: subject, left: 600, top: 700 }])
    .png()
    .toBuffer();
  const { buffer } = await processImage(buf);
  // Sample a corner: it must be the padding colour, and it must not be black.
  const { data } = await sharp(buffer)
    .extract({ left: 0, top: 0, width: 8, height: 8 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.ok(
    data[0] > 240 && data[1] > 240 && data[2] > 240,
    `corner is ${data[0]},${data[1]},${data[2]}`
  );
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed\n`);
if (failed.length > 0) process.exit(1);
