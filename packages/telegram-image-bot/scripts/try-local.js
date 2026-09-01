/**
 * Run the exact bot pipeline over a local folder — no Telegram token needed.
 * Usage: npm run try -- <input-dir> [output-dir]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { processImage, outputExtension } from "../src/process.js";
import { config } from "../src/config.js";

const [inputDir, outputDir = "out"] = process.argv.slice(2);
if (!inputDir) {
  console.error("usage: npm run try -- <input-dir> [output-dir]");
  process.exit(1);
}

const SUPPORTED = /\.(jpe?g|png|webp|tiff?|bmp|avif|heic|heif)$/i;
const entries = (await fs.readdir(inputDir)).filter((f) => SUPPORTED.test(f)).sort();
if (entries.length === 0) {
  console.error(`no images found in ${inputDir}`);
  process.exit(1);
}

await fs.mkdir(outputDir, { recursive: true });
console.log(
  `\n${entries.length} images -> ${config.output.width}x${config.output.height} ` +
    `${config.output.format} q${config.output.quality} (AI layer ${config.ai.enabled ? "on" : "off"})\n`
);

const ext = outputExtension();
const started = Date.now();
let failures = 0;

for (const [i, file] of entries.entries()) {
  const label = `${i + 1}/${entries.length} ${file}`;
  try {
    const buf = await fs.readFile(path.join(inputDir, file));
    const t0 = Date.now();
    const { buffer, info } = await processImage(buf);
    const name = `${path.parse(file).name}.${ext}`;
    await fs.writeFile(path.join(outputDir, name), buffer);
    console.log(
      `  ok   ${label}  ${info.original.width}x${info.original.height}` +
        ` -> crop ${info.crop.width}x${info.crop.height}` +
        ` -> ${info.output.width}x${info.output.height}` +
        `  [${info.source}/${info.reason}, dropped ${info.droppedComponents},` +
        ` ${(buffer.length / 1024).toFixed(0)} KB, ${Date.now() - t0} ms]`
    );
  } catch (err) {
    failures++;
    console.log(`  FAIL ${label}  ${err.message}`);
  }
}

console.log(
  `\ndone in ${((Date.now() - started) / 1000).toFixed(1)}s — ` +
    `${entries.length - failures} ok, ${failures} failed -> ${path.resolve(outputDir)}\n`
);
