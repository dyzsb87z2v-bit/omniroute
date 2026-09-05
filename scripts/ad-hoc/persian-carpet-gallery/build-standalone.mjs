#!/usr/bin/env node
/*
 * Bundles the gallery into one self-contained HTML file: styles, engine and the reference
 * photograph (as a data URI) all inline, so it can be dropped anywhere — a static host, a CMS
 * field, an <iframe> on someone else's theme — with nothing to fetch at runtime.
 *
 *   node scripts/ad-hoc/persian-carpet-gallery/build-standalone.mjs [outfile]
 *
 * The photograph stays PNG on purpose. At JPEG q98 the compression error is 1.50/255, roughly
 * fifteen times the whole render pipeline's error against the source (0.10/255) — it would
 * become the dominant loss in a piece whose entire premise is that the carpets are untouched.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, "milaedia-standalone.html");

const read = (f) => fs.readFileSync(path.join(here, f), "utf8");
const html = read("index.html");
const js = read("gallery.js");
const png = fs.readFileSync(path.join(here, "gallery.png"));

// mount() falls back to window.MILAEDIA_SRC when no data-src is given, so the engine itself
// needs no edit — the bundle just defines that global ahead of it.
if (!js.includes("window.MILAEDIA_SRC")) {
  throw new Error("gallery.js no longer reads window.MILAEDIA_SRC — update this bundler");
}

const SCRIPT_TAG = '<script src="gallery.js"></script>';
if (!html.includes(SCRIPT_TAG)) {
  throw new Error(`index.html no longer loads the engine via ${SCRIPT_TAG} — update this bundler`);
}

const inline = [
  "<script>",
  `window.MILAEDIA_SRC = "data:image/png;base64,${png.toString("base64")}";`,
  "",
  js,
  "</scr" + "ipt>",
].join("\n");

const bundled = html.replace(SCRIPT_TAG, inline).replace(' data-src="gallery.png"', "");
fs.writeFileSync(out, bundled);
console.log(`${out}  ${(bundled.length / 1048576).toFixed(2)} MB`);
