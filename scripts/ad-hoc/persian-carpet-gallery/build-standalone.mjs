#!/usr/bin/env node
/*
 * Bundles the gallery into one self-contained HTML file: styles, engine and the reference
 * photograph (as a data URI) all inline, so it can be dropped anywhere — a static host, a CMS
 * field, an artifact — with nothing to fetch at runtime.
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
let js = read("gallery.js");
const png = fs.readFileSync(path.join(here, "gallery.png"));

const IMAGE_CALL = 'loadImage("gallery.png")';
if (!js.includes(IMAGE_CALL)) {
  throw new Error(`gallery.js no longer contains ${IMAGE_CALL} — update this bundler`);
}
js = js.replace(IMAGE_CALL, "loadImage(GALLERY_SRC)");

const inline =
  "<script>\n" +
  'const GALLERY_SRC = "data:image/png;base64,' +
  png.toString("base64") +
  '";\n\n' +
  js +
  "\n</scr" +
  "ipt>";

const bundled = html.replace('<script src="gallery.js"></script>', inline);
if (bundled === html) {
  throw new Error("index.html no longer loads gallery.js by that tag — update this bundler");
}

fs.writeFileSync(out, bundled);
console.log(`${out}  ${(bundled.length / 1048576).toFixed(2)} MB`);
