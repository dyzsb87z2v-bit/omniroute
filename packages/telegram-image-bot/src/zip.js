import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import { config } from "./config.js";

/** Group files so each archive stays under the Telegram upload limit. */
function planParts(files, maxBytes) {
  const parts = [];
  let current = [];
  let currentBytes = 0;
  for (const file of files) {
    // A single oversized file still gets its own part rather than being dropped.
    if (current.length > 0 && currentBytes + file.bytes > maxBytes) {
      parts.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += file.bytes;
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

function writeArchive(files, outPath, level) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level } });
    output.on("close", () => resolve(archive.pointer()));
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    for (const file of files) archive.file(file.path, { name: file.name });
    archive.finalize();
  });
}

/**
 * Zip the processed files, splitting into numbered parts when needed.
 *
 * @param {{path:string,name:string,bytes:number}[]} files
 * @param {string} outDir
 * @param {string} baseName
 * @returns {Promise<{path:string,name:string,bytes:number,count:number}[]>}
 */
export async function createZipParts(files, outDir, baseName = "processed") {
  // JPEG/WebP are already compressed — deflating them again only costs time.
  const level = config.output.format === "png" ? 6 : 0;
  const parts = planParts(files, config.batch.maxZipBytes);

  const built = [];
  for (const [index, group] of parts.entries()) {
    const name =
      parts.length === 1 ? `${baseName}.zip` : `${baseName}_part${index + 1}of${parts.length}.zip`;
    const outPath = path.join(outDir, name);
    const bytes = await writeArchive(group, outPath, level);
    built.push({ path: outPath, name, bytes, count: group.length });
  }
  return built;
}
