/**
 * Generate a small set of synthetic test images (borders, captions, transparency, EXIF).
 * Usage: node scripts/make-samples.js <output-dir>
 */
import sharp from "sharp";
import fs from "node:fs/promises";
const dir = process.argv[2];
await fs.mkdir(dir, { recursive: true });

// 1) product-style photo: wide white margin + caption + page number
const svg1 = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200">
<rect width="100%" height="100%" fill="#fdfdfb"/>
<defs><radialGradient id="g"><stop offset="0%" stop-color="#f6c453"/><stop offset="100%" stop-color="#b8541c"/></radialGradient></defs>
<ellipse cx="800" cy="520" rx="300" ry="230" fill="url(#g)"/>
<rect x="640" y="700" width="320" height="40" rx="20" fill="#3d3d3d" opacity="0.25"/>
<text x="120" y="1120" font-family="sans-serif" font-size="34" fill="#333">Model No. 4471-A / catalogue 2026</text>
<text x="1480" y="90" font-family="sans-serif" font-size="30" fill="#555">page 12</text>
</svg>`;
await sharp(Buffer.from(svg1)).jpeg({ quality: 95 }).toFile(`${dir}/01-product-with-caption.jpg`);

// 2) tall portrait, subject offset, thin border
const svg2 = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1600">
<rect width="100%" height="100%" fill="#eef3f7"/>
<rect x="180" y="300" width="520" height="900" rx="40" fill="#2f6f8f"/>
<circle cx="440" cy="520" r="140" fill="#f2e6d0"/>
<text x="60" y="1560" font-family="sans-serif" font-size="40" fill="#7a7a7a">IMG_0421</text>
</svg>`;
await sharp(Buffer.from(svg2)).jpeg({ quality: 95 }).toFile(`${dir}/02-portrait.jpg`);

// 3) full-bleed photo (nothing to trim)
const svg3 = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="900">
<defs><linearGradient id="l" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0f2027"/><stop offset="50%" stop-color="#203a43"/><stop offset="100%" stop-color="#2c5364"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#l)"/>
<circle cx="1100" cy="220" r="120" fill="#ffe9a8"/>
</svg>`;
await sharp(Buffer.from(svg3)).jpeg({ quality: 95 }).toFile(`${dir}/03-fullbleed.jpg`);

// 4) transparent PNG logo with huge empty padding
const logo = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="180">
<rect width="420" height="180" rx="24" fill="#8e44ad"/><circle cx="90" cy="90" r="52" fill="#ffd166"/></svg>`);
await sharp({
  create: { width: 2400, height: 2400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([{ input: await sharp(logo).png().toBuffer(), left: 900, top: 1100 }])
  .png()
  .toFile(`${dir}/04-logo-transparent.png`);

// 5) large photo with rotated EXIF
const svg5 = `<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="2000">
<rect width="100%" height="100%" fill="#ffffff"/>
<rect x="900" y="500" width="1100" height="900" fill="#16a085"/>
<text x="120" y="1900" font-family="sans-serif" font-size="60" fill="#222">scan-2026-09</text>
</svg>`;
await sharp(Buffer.from(svg5))
  .withMetadata({ orientation: 6 })
  .jpeg({ quality: 95 })
  .toFile(`${dir}/05-exif-rotated.jpg`);

// 6) off-white background (not pure white) with subject touching one edge
const svg6 = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200">
<rect width="100%" height="100%" fill="#f0ece4"/>
<rect x="0" y="380" width="700" height="420" fill="#c0392b"/>
</svg>`;
await sharp(Buffer.from(svg6)).jpeg({ quality: 95 }).toFile(`${dir}/06-edge-touching.jpg`);
console.log("generated");
