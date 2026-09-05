/*
 * MiLAEDiA — interactive 2.5D reconstruction of a Persian carpet gallery photograph.
 *
 * The reference photograph is the only source of pixels. Nothing is redrawn, restyled or
 * generated: a coarse metric reconstruction of the room is textured by PROJECTIVE MAPPING
 * from the camera that took the picture, so at the home pose every fragment samples exactly
 * the pixel it covers and the frame is identical to the original. Moving the camera keeps the
 * photograph glued to that geometry — the carpets are transformed, never re-created.
 *
 * Perspective solved from the image itself (see README.md):
 *   horizon y = 0.355   vertical extent T = 1.446 / unit depth   eye height 1.55 m
 *   verticals stay vertical + horizon above centre  =>  shift-lens (asymmetric) frustum.
 */

/* ------------------------------------------------------------------ *
 * 1. Measured scene constants
 * ------------------------------------------------------------------ */

const IMG_W = 941;
const IMG_H = 1672;
const ASPECT = IMG_W / IMG_H; // 0.56280

const HORIZON = 0.355; // horizon line, normalised image y (from the carpet cross-ratio)
const TEXT = 1.446; // world height spanned per unit depth (vertical field)
const EYE = 1.55; // camera height above the floor, metres

const FLOOR_Y = -EYE; // floor plane, relative to eye level
const CEIL_Y = 2.25; // ceiling plane (banner hangs from it at 9 m — verified)
const WALL_X = 2.8; // side walls; corners land in the dark column gaps at x 0.2225 / 0.7775
const BACK_Z = -12.4; // back wall
const FRONT_Z = 1.0; // surfaces extend a little behind the camera for lateral travel

const NEAR = 0.1;
const FAR = 60.0;

/* Camera envelope. Kept deliberately tight: beyond this the frame would ask for scenery
 * that simply does not exist in the photograph. */
const TRAVEL_X = 0.55; // metres of lateral truck each way
const TRAVEL_Y = 0.1; // metres of vertical rise/fall
/* The camera keeps looking slightly back toward the room's axis as it trucks. That costs
 * nothing in parallax — parallax comes from the translation — but it swings the frustum edge
 * back inside the photograph, which is what decides how much of the frame falls off the
 * original image. With these values everything past ~7 m stays fully covered. */
const LOOK_BIAS = 0.18; // fraction of the truck the aim point follows
const LOOK_PIVOT = 7.2; // metres ahead that the aim point sits

/* ------------------------------------------------------------------ *
 * 2. Occluding objects — silhouettes traced off the reference image
 *    (normalised image coordinates, y measured downward from the top)
 * ------------------------------------------------------------------ */

const CARDS = [
  {
    // MiLAEDiA banner. Hangs from the ceiling, so it is the one card given an explicit depth
    // instead of a floor contact line — 8.7 m puts it just in front of where the ceiling
    // plane reaches this row of the image, exactly as it occludes the ceiling in the photo.
    name: "banner",
    depth: 8.7,
    sway: 0,
    poly: [
      [0.19, 0.181],
      [0.821, 0.181],
      [0.821, 0.251],
      [0.19, 0.251],
    ],
  },
  {
    name: "plantLeft",
    base: [
      [0.348, 0.494],
      [0.374, 0.493],
    ],
    sway: 1,
    poly: [
      [0.334, 0.35],
      [0.353, 0.347],
      [0.372, 0.357],
      [0.384, 0.378],
      [0.382, 0.404],
      [0.376, 0.431],
      [0.377, 0.47],
      [0.373, 0.495],
      [0.347, 0.496],
      [0.342, 0.47],
      [0.34, 0.432],
      [0.326, 0.41],
      [0.318, 0.386],
      [0.322, 0.362],
    ],
  },
  {
    name: "plantRight",
    base: [
      [0.64, 0.494],
      [0.666, 0.493],
    ],
    sway: 1,
    poly: [
      [0.628, 0.352],
      [0.65, 0.347],
      [0.669, 0.356],
      [0.681, 0.378],
      [0.684, 0.404],
      [0.677, 0.432],
      [0.671, 0.47],
      [0.667, 0.496],
      [0.641, 0.495],
      [0.635, 0.47],
      [0.633, 0.434],
      [0.62, 0.41],
      [0.614, 0.384],
      [0.618, 0.362],
    ],
  },
  {
    name: "stackLeftFar",
    base: [
      [0.195, 0.5],
      [0.308, 0.513],
    ],
    sway: 0,
    poly: [
      [0.188, 0.45],
      [0.25, 0.441],
      [0.312, 0.452],
      [0.314, 0.487],
      [0.308, 0.514],
      [0.25, 0.518],
      [0.196, 0.503],
    ],
  },
  {
    name: "stackRightFar",
    base: [
      [0.782, 0.521],
      [0.66, 0.497],
    ],
    sway: 0,
    poly: [
      [0.65, 0.449],
      [0.712, 0.44],
      [0.79, 0.452],
      [0.792, 0.489],
      [0.783, 0.522],
      [0.712, 0.519],
      [0.657, 0.499],
    ],
  },
  {
    // The two near platforms run away from the camera at an angle, from roughly 4.2 m at the
    // frame edge to 6.7 m at their inner corner. Their contact line is traced off the
    // photograph so the card is a correctly oriented receding plane, not a flat billboard.
    name: "stackLeftNear",
    base: [
      [0.0, 0.607],
      [0.206, 0.514],
    ],
    sway: 0,
    poly: [
      [0.0, 0.452],
      [0.06, 0.458],
      [0.12, 0.466],
      [0.17, 0.473],
      [0.203, 0.479],
      [0.209, 0.5],
      [0.206, 0.515],
      [0.14, 0.546],
      [0.07, 0.576],
      [0.0, 0.608],
    ],
  },
  {
    name: "stackRightNear",
    base: [
      [1.0, 0.646],
      [0.772, 0.522],
    ],
    sway: 0,
    poly: [
      [1.0, 0.44],
      [0.9, 0.452],
      [0.82, 0.462],
      [0.784, 0.47],
      [0.776, 0.5],
      [0.772, 0.522],
      [0.8, 0.545],
      [0.845, 0.572],
      [0.895, 0.6],
      [0.95, 0.622],
      [1.0, 0.647],
    ],
  },
];

/* ------------------------------------------------------------------ *
 * 3. Minimal 4x4 math (column-major, GL order)
 * ------------------------------------------------------------------ */

const m4 = {
  identity: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),

  /** Off-axis ("shift lens") frustum — reproduces the photograph's raised horizon. */
  frustum(l, r, b, t, n, f) {
    return new Float32Array([
      (2 * n) / (r - l),
      0,
      0,
      0,
      0,
      (2 * n) / (t - b),
      0,
      0,
      (r + l) / (r - l),
      (t + b) / (t - b),
      -(f + n) / (f - n),
      -1,
      0,
      0,
      (-2 * f * n) / (f - n),
      0,
    ]);
  },

  multiply(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] =
          a[r] * b[c * 4] +
          a[4 + r] * b[c * 4 + 1] +
          a[8 + r] * b[c * 4 + 2] +
          a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  },

  /** View matrix for a camera at (x,y,z) yawed by `yaw` radians about +Y. Yaw only: no pitch
   *  and no roll, so the vertical lines of the photograph stay vertical. */
  view(x, y, z, yaw) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // Ry(-yaw) * Translate(-eye)
    const tx = -x * c + z * s;
    const ty = -y;
    const tz = -x * s - z * c;
    return new Float32Array([c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, tx, ty, tz, 1]);
  },
};

/** Home camera intrinsics, as an off-axis frustum at the near plane. */
function homeProjection() {
  const hx = 0.5 * ASPECT * TEXT * NEAR;
  return m4.frustum(-hx, hx, (HORIZON - 1) * TEXT * NEAR, HORIZON * TEXT * NEAR, NEAR, FAR);
}

/** Image point (x,y in 0..1, y down) back-projected to `depth` metres in front of the camera. */
function unproject(ix, iy, depth) {
  return [(ix - 0.5) * ASPECT * TEXT * depth, (HORIZON - iy) * TEXT * depth, -depth];
}

/** Depth at which a ray through image row `iy` meets the floor. */
function floorDepth(iy) {
  return EYE / ((iy - HORIZON) * TEXT);
}

/** Where an image point that sits on the floor lands in world space. */
function floorPoint(ix, iy) {
  return unproject(ix, iy, floorDepth(iy));
}

/**
 * The plane a card stands on. Objects like the near display platforms run away from the
 * camera at an angle, so their card is the vertical plane containing their traced floor
 * contact line — a receding surface, not a flat billboard parallel to the screen.
 * Returns { normal, offset } with normal . x = offset, plus a representative depth.
 */
function cardPlane(card) {
  if (!card.base) {
    return { n: [0, 0, -1], c: card.depth, depth: card.depth };
  }
  const a = card.base[0].slice();
  const b = card.base[1].slice();

  // No part of the silhouette may hang below the contact line — anything that did would sit
  // under the floor plane, be occluded by it, and expose a hairline of the backplate.
  const lineY = (x) => a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0] || 1e-6);
  let drop = 0;
  for (const [px, py] of card.poly) drop = Math.max(drop, py - lineY(px));
  a[1] += drop;
  b[1] += drop;

  const p0 = floorPoint(a[0], a[1]);
  const p1 = floorPoint(b[0], b[1]);
  const dx = p1[0] - p0[0];
  const dz = p1[2] - p0[2];
  // up x direction, so the plane stands vertically on the contact line
  let nx = dz;
  let nz = -dx;
  const len = Math.hypot(nx, nz) || 1;
  nx /= len;
  nz /= len;
  // A display platform's front face stands a few centimetres in front of where its base meets
  // the floor. Without that offset the card is exactly coplanar with the floor along its
  // contact line and the floor wins there, exposing a hairline of the backplate.
  let c = nx * p0[0] + nz * p0[2];
  c -= Math.sign(c || 1) * CARD_LIFT;
  return { n: [nx, 0, nz], c, depth: (floorDepth(a[1]) + floorDepth(b[1])) / 2 };
}

/** Image point projected onto a card's plane. */
function planePoint(plane, ix, iy) {
  const d = unproject(ix, iy, 1);
  const denom = plane.n[0] * d[0] + plane.n[2] * d[2];
  if (Math.abs(denom) < 1e-5) return unproject(ix, iy, plane.depth);
  const t = plane.c / denom;
  if (!(t > 0.05)) return unproject(ix, iy, plane.depth);
  return [d[0] * t, d[1] * t, d[2] * t];
}

/* ------------------------------------------------------------------ *
 * 4. Silhouette masks + backplate inpainting
 *
 * The masks are rasterised from the traced polygons. The backplate is the photograph with
 * every occluder removed by a push-pull pyramid fill: it only ever diffuses neighbouring
 * pixels that already exist in the image, so no artwork is invented — it just supplies
 * plausible floor/wall behind an object once the camera steps far enough to look past it.
 * ------------------------------------------------------------------ */

const MASK_RES = 320; // longest edge of a per-card mask, plenty for a soft silhouette
const MASK_PAD = 0.02; // bbox padding, normalised image units
const FEATHER = 2.0; // mask edge softness, in mask pixels
/* The backplate hole is dilated so no rim of the object survives behind it; the card mask is
 * dilated slightly further so the card always covers the hole and no blurred halo can show. */
const HOLE_DILATE = 3.0; // image pixels
const CARD_DILATE = 10.0; // image pixels — the feather must clear the hole entirely
const CARD_LIFT = 0.05; // metres a card stands in front of its floor contact line

/** Separable box blur over a single-channel Uint8 buffer (deterministic across browsers). */
function boxBlur(src, w, h, radius) {
  const r = Math.max(1, Math.round(radius));
  const tmp = new Float32Array(w * h);
  const out = new Uint8ClampedArray(w * h);
  const n = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[y * w + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / n;
      const add = src[y * w + Math.min(w - 1, x + r + 1)];
      const sub = src[y * w + Math.min(w - 1, Math.max(0, x - r))];
      acc += add - sub;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n;
      const add = tmp[Math.min(h - 1, y + r + 1) * w + x];
      const sub = tmp[Math.min(h - 1, Math.max(0, y - r)) * w + x];
      acc += add - sub;
    }
  }
  return out;
}

/** Bounding box of a polygon, padded and clamped to the frame. */
function polyBounds(poly) {
  let x0 = 1,
    y0 = 1,
    x1 = 0,
    y1 = 0;
  for (const [x, y] of poly) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return {
    x0: Math.max(0, x0 - MASK_PAD),
    y0: Math.max(0, y0 - MASK_PAD),
    x1: Math.min(1, x1 + MASK_PAD),
    y1: Math.min(1, y1 + MASK_PAD),
  };
}

/**
 * Rasterise one card's silhouette into a small single-channel texture covering its bbox.
 * The edge is feathered, and any edge that sits on the frame border is faded out further so
 * an object cropped by the original frame dissolves into shadow instead of showing a slice.
 */
function buildMask(card) {
  const b = polyBounds(card.poly);
  const bw = b.x1 - b.x0;
  const bh = b.y1 - b.y0;
  const scale = MASK_RES / Math.max(bw * IMG_W, bh * IMG_H);
  const w = Math.max(8, Math.round(bw * IMG_W * scale));
  const h = Math.max(8, Math.round(bh * IMG_H * scale));

  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = 2 * CARD_DILATE * scale;
  ctx.beginPath();
  card.poly.forEach(([px, py], i) => {
    const x = ((px - b.x0) / bw) * w;
    const y = ((py - b.y0) / bh) * h;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const rgba = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = rgba[i * 4];
  const soft = boxBlur(gray, w, h, FEATHER);
  // Note: silhouettes clipped by the frame edge are NOT faded here. Baking a fade into the
  // mask would let the backplate show through at rest. The dissolve is applied in the shader
  // instead, ramped by how far the camera has moved.
  return { data: soft, w, h, bounds: b };
}

/**
 * Push-pull inpaint. Builds a weighted pyramid of the photograph in which occluder pixels
 * carry zero weight, then pulls colour back down from coarser levels to fill them.
 * Runs on a half-resolution copy — the filled areas are only ever glimpsed obliquely.
 */
function inpaint(pixels, holes, w, h) {
  const levels = [];
  let cw = w,
    ch = h;
  let col = new Float32Array(w * h * 3);
  let wgt = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const valid = 1 - holes[i] / 255;
    wgt[i] = valid;
    col[i * 3] = pixels[i * 4] * valid;
    col[i * 3 + 1] = pixels[i * 4 + 1] * valid;
    col[i * 3 + 2] = pixels[i * 4 + 2] * valid;
  }
  levels.push({ col, wgt, w: cw, h: ch });

  // pull — restrict
  while (cw > 2 && ch > 2) {
    const nw = Math.max(1, cw >> 1);
    const nh = Math.max(1, ch >> 1);
    const nc = new Float32Array(nw * nh * 3);
    const nwg = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let r = 0,
          g = 0,
          b = 0,
          a = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(cw - 1, x * 2 + dx);
            const sy = Math.min(ch - 1, y * 2 + dy);
            const si = sy * cw + sx;
            r += col[si * 3];
            g += col[si * 3 + 1];
            b += col[si * 3 + 2];
            a += wgt[si];
          }
        }
        const di = y * nw + x;
        nc[di * 3] = r;
        nc[di * 3 + 1] = g;
        nc[di * 3 + 2] = b;
        nwg[di] = a;
      }
    }
    // renormalise so each level stores premultiplied colour with weight <= 1
    for (let i = 0; i < nw * nh; i++) {
      if (nwg[i] > 0) {
        const s = Math.min(1, nwg[i]) / nwg[i];
        nc[i * 3] *= s;
        nc[i * 3 + 1] *= s;
        nc[i * 3 + 2] *= s;
        nwg[i] = Math.min(1, nwg[i]);
      }
    }
    levels.push({ col: nc, wgt: nwg, w: nw, h: nh });
    col = nc;
    wgt = nwg;
    cw = nw;
    ch = nh;
  }

  // push — prolongate with weighted bilinear sampling so the fill is a smooth gradient of the
  // surrounding pixels rather than a mosaic of pyramid blocks
  const sample = (lv, fx, fy, out) => {
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    let r = 0,
      g = 0,
      b = 0,
      wsum = 0;
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const sx = Math.min(lv.w - 1, Math.max(0, x0 + i));
        const sy = Math.min(lv.h - 1, Math.max(0, y0 + j));
        const si = sy * lv.w + sx;
        const aw = lv.wgt[si];
        if (aw <= 0) continue;
        const bw = (i ? tx : 1 - tx) * (j ? ty : 1 - ty) * aw;
        r += (lv.col[si * 3] / aw) * bw;
        g += (lv.col[si * 3 + 1] / aw) * bw;
        b += (lv.col[si * 3 + 2] / aw) * bw;
        wsum += bw;
      }
    }
    if (wsum <= 0) return false;
    out[0] = r / wsum;
    out[1] = g / wsum;
    out[2] = b / wsum;
    return true;
  };

  const tmp = [0, 0, 0];
  for (let l = levels.length - 2; l >= 0; l--) {
    const fine = levels[l];
    const coarse = levels[l + 1];
    for (let y = 0; y < fine.h; y++) {
      for (let x = 0; x < fine.w; x++) {
        const i = y * fine.w + x;
        if (fine.wgt[i] >= 0.999) continue;
        if (!sample(coarse, (x + 0.5) * 0.5 - 0.5, (y + 0.5) * 0.5 - 0.5, tmp)) continue;
        const a = fine.wgt[i];
        fine.col[i * 3] += tmp[0] * (1 - a);
        fine.col[i * 3 + 1] += tmp[1] * (1 - a);
        fine.col[i * 3 + 2] += tmp[2] * (1 - a);
        fine.wgt[i] = 1;
      }
    }
  }

  // Everything this fill covers is floor and wall that the object was standing in front of —
  // in a real gallery that is the object's own shadow. Shading the core of each hole (the rim
  // is left alone, so the join stays invisible) keeps a reveal reading as depth rather than as
  // a bright smear.
  const core = boxBlur(holes, w, h, Math.max(3, Math.round(w * 0.03)));
  const base = levels[0];
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const shade = 1 - 0.48 * (core[i] / 255) * (holes[i] / 255);
    out[i * 4] = base.col[i * 3] * shade;
    out[i * 4 + 1] = base.col[i * 3 + 1] * shade;
    out[i * 4 + 2] = base.col[i * 3 + 2] * shade;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Photograph with all occluders removed — what the room surfaces are textured with.
 * The fill is computed at half resolution (it is only ever glimpsed obliquely) but composited
 * back over the FULL resolution photograph, so every pixel outside a hole is untouched.
 */
function buildBackplate(image, masks) {
  const W = IMG_W;
  const H = IMG_H;
  const hw = W >> 1;
  const hh = H >> 1;

  // --- hole mask: every silhouette, dilated so no rim of the object survives behind it ---
  const hole = document.createElement("canvas");
  hole.width = hw;
  hole.height = hh;
  const hctx = hole.getContext("2d", { willReadFrequently: true });
  hctx.fillStyle = "#000";
  hctx.fillRect(0, 0, hw, hh);
  hctx.fillStyle = "#fff";
  hctx.strokeStyle = "#fff";
  hctx.lineJoin = "round";
  hctx.lineCap = "round";
  hctx.lineWidth = HOLE_DILATE; // half-res canvas => a stroke of D covers D image pixels
  for (const card of CARDS) {
    hctx.beginPath();
    card.poly.forEach(([px, py], i) =>
      i ? hctx.lineTo(px * hw, py * hh) : hctx.moveTo(px * hw, py * hh)
    );
    hctx.closePath();
    hctx.fill();
    hctx.stroke();
  }
  const hrgba = hctx.getImageData(0, 0, hw, hh).data;
  const holes = new Uint8ClampedArray(hw * hh);
  for (let i = 0; i < hw * hh; i++) holes[i] = hrgba[i * 4];

  // --- fill the holes from the surrounding pixels ---
  const src = document.createElement("canvas");
  src.width = hw;
  src.height = hh;
  const sctx = src.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(image, 0, 0, hw, hh);
  const filled = inpaint(sctx.getImageData(0, 0, hw, hh).data, holes, hw, hh);

  // --- patch: the fill, cut to the hole shape via its alpha channel ---
  const patchSrc = new Uint8ClampedArray(hw * hh * 4);
  for (let i = 0; i < hw * hh; i++) {
    patchSrc[i * 4] = filled[i * 4];
    patchSrc[i * 4 + 1] = filled[i * 4 + 1];
    patchSrc[i * 4 + 2] = filled[i * 4 + 2];
    patchSrc[i * 4 + 3] = holes[i];
  }
  const patch = document.createElement("canvas");
  patch.width = hw;
  patch.height = hh;
  patch.getContext("2d").putImageData(new ImageData(patchSrc, hw, hh), 0, 0);

  // --- composite over the untouched photograph at full resolution ---
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const octx = out.getContext("2d");
  octx.drawImage(image, 0, 0, W, H);
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(patch, 0, 0, W, H);
  return out;
}

/* ------------------------------------------------------------------ *
 * 5. Shaders
 *
 * Everything is drawn with projective texturing from the ORIGINAL camera: the vertex shader
 * projects each rest-pose vertex through the home view-projection matrix, and the fragment
 * shader divides by w to get the exact image coordinate that surface point occupied in the
 * photograph. At the home pose uMVP == uHomeVP, so every pixel resolves to itself.
 * ------------------------------------------------------------------ */

const SCENE_VS = `#version 300 es
precision highp float;

in vec3 aPos;

uniform mat4 uMVP;        // current camera
uniform mat4 uHomeVP;     // camera that took the photograph
uniform float uSway;      // foliage animation amount (0 for everything else)
uniform vec2  uSwaySpan;  // world y of the base and the top of a plant card
uniform float uTime;
uniform float uPhase;

out vec4 vProj;
out vec3 vWorld;

void main() {
  // Texture coordinates come from the REST pose, so the photograph stays glued to the
  // surface even while the surface itself bends.
  vProj = uHomeVP * vec4(aPos, 1.0);

  vec3 p = aPos;
  if (uSway > 0.0) {
    float t = clamp((aPos.y - uSwaySpan.x) / max(0.001, uSwaySpan.y - uSwaySpan.x), 0.0, 1.0);
    float stiff = pow(t, 1.7);                       // rooted at the pot, free at the fronds
    float a = uTime * 0.62 + uPhase;
    p.x += (sin(a) * 0.62 + sin(a * 2.13 + 1.7) * 0.38) * uSway * stiff;
    p.y += sin(a * 1.31 + 0.6) * uSway * 0.22 * stiff;
    p.z += cos(a * 0.87 + 2.2) * uSway * 0.45 * stiff;
  }

  vWorld = p;
  gl_Position = uMVP * vec4(p, 1.0);
}`;

const SCENE_FS = `#version 300 es
precision highp float;

in vec4 vProj;
in vec3 vWorld;

uniform sampler2D uTex;
uniform sampler2D uMask;
uniform vec4  uMaskRect;   // x0, y0, width, height in image space
uniform float uUseMask;
uniform float uEdgeSoft;  // dissolves a clipped silhouette at the frame border, 0 at rest
uniform float uIsFloor;
uniform float uMirrorX;    // extend this surface past the frame by mirroring (floor only)
uniform float uSheen;      // polished-floor highlight, scales with camera motion
uniform float uSheenX;

out vec4 outColor;

const vec3 VOID_COLOR = vec3(0.0135, 0.0115, 0.0095); // unlit periphery beyond the photograph

void main() {
  // Perspective divide of the home-camera projection => the exact source pixel.
  // Geometry can straddle the home camera's own plane, so guard the divide.
  float wRaw = vProj.w;
  float front = step(0.0005, wRaw);
  float w = max(abs(wRaw), 1.0e-3);
  vec3 ndc = vProj.xyz / w;
  vec2 iuv = vec2(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);   // image space, y downward

  // Anything the camera reaches past the edge of the photograph has no source pixel. Rather
  // than a hard black wall, the periphery rolls off over a long ramp so it reads as the room
  // falling into shadow. Inside the frame the ramp is exactly 1, so the image is untouched.
  const float F = 0.17;
  vec2 f = smoothstep(-F, 0.0, iuv) * (1.0 - smoothstep(1.0, 1.0 + F, iuv));
  float inside = f.x * f.y * front;

  // The near floor is plain dark marble at both edges, so it can legitimately be continued by
  // mirroring the existing pixels outward — real marble instead of a void. Gated well below
  // the hero carpet so no carpet is ever duplicated.
  vec2 suv = iuv;
  if (uMirrorX > 0.5) {
    float gate = smoothstep(0.60, 0.72, iuv.y);
    // The fold reaches at most 10% into the frame. The hero carpet's nearest fringe corner is
    // at x 0.118 / 0.878, so it can never be picked up and duplicated.
    const float BAND = 0.10;
    float m = iuv.x;
    if (iuv.x < 0.0) m = clamp(-iuv.x, 0.0, BAND);
    else if (iuv.x > 1.0) m = 1.0 - clamp(iuv.x - 1.0, 0.0, BAND);
    suv.x = mix(iuv.x, m, gate);
    inside = max(inside, gate * f.y * front * 0.82);
  }

  vec3 col = texture(uTex, clamp(suv, 0.0, 1.0)).rgb;
  col = mix(VOID_COLOR, col, 0.13 + 0.87 * inside);

  // Polished marble: a broad soft reflection of the room lighting that slides as you move.
  if (uIsFloor > 0.5 && uSheen > 0.0) {
    float band = exp(-pow((vWorld.x - uSheenX) * 0.6, 2.0));
    float reach = smoothstep(-11.5, -2.5, vWorld.z) * smoothstep(-0.6, -2.2, vWorld.z);
    col *= 1.0 + uSheen * band * reach * 0.19;
  }

  float alpha = 1.0;
  if (uUseMask > 0.5) {
    vec2 muv = (iuv - uMaskRect.xy) / uMaskRect.zw;
    float outside = step(muv.x, 0.0) + step(1.0, muv.x) + step(muv.y, 0.0) + step(1.0, muv.y);
    alpha = texture(uMask, clamp(muv, 0.0, 1.0)).r * (1.0 - min(1.0, outside)) * f.x * f.y * front;
    // An object the photograph cut off at the frame edge would otherwise read as sliced once
    // it moves inward, so its border dissolves into the gallery's shadow as the camera travels.
    float border = smoothstep(0.0, 0.028, iuv.x) * (1.0 - smoothstep(0.972, 1.0, iuv.x));
    alpha *= mix(1.0, border, uEdgeSoft);
    if (alpha < 0.02) discard;
  }

  outColor = vec4(col, alpha);
}`;

const POST_VS = `#version 300 es
precision highp float;
out vec2 vUV;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const POST_FS = `#version 300 es
precision highp float;

in vec2 vUV;

uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform vec2  uTexel;      // 1 / render-target size
uniform float uSuper;      // supersample ratio (render size / display size)
uniform float uDof;        // defocus strength, ramps with camera motion
uniform float uFocus;      // focus distance, metres
uniform float uGrain;
uniform float uTime;

out vec4 outColor;

const float NEAR_P = ${NEAR.toFixed(4)};
const float FAR_P  = ${FAR.toFixed(4)};

float viewDepth(vec2 uv) {
  float d = texture(uDepth, uv).r * 2.0 - 1.0;
  return (2.0 * NEAR_P * FAR_P) / (FAR_P + NEAR_P - d * (FAR_P - NEAR_P));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  float z = viewDepth(vUV);

  // Circle of confusion. The photograph already carries its own depth of field, so this only
  // adds the extra defocus earned by moving the camera, and it is capped low enough that a
  // carpet never softens.
  float coc = clamp(abs(z - uFocus) / 13.0, 0.0, 1.0);
  coc = smoothstep(0.14, 1.0, coc) * uDof;

  // One tap radius covers both the supersample resolve and the defocus. At rest both are
  // zero, every tap lands on the same texel, and the pass degenerates to an exact copy.
  float radius = max(uSuper, coc * 2.3);

  vec3 sum = texture(uColor, vUV).rgb;
  float wsum = 1.0;
  const float GA = 2.39996323;
  for (int i = 0; i < 8; i++) {
    float a = GA * float(i);
    float r = sqrt((float(i) + 0.5) / 8.0) * radius;
    vec2 off = vec2(cos(a), sin(a)) * r * uTexel;
    sum += texture(uColor, vUV + off).rgb;
    wsum += 1.0;
  }
  vec3 col = sum / wsum;

  // Film grain, scaled by motion so the resting frame is bit-for-bit the photograph.
  if (uGrain > 0.0) {
    float n = hash(gl_FragCoord.xy + fract(uTime) * 137.0) - 0.5;
    col += n * uGrain * 0.014;
  }

  outColor = vec4(col, 1.0);
}`;

/* ------------------------------------------------------------------ *
 * 6. Geometry
 * ------------------------------------------------------------------ */

/** Bilinear grid over four world-space corners, given in order TL, TR, BR, BL. */
function grid(tl, tr, br, bl, nx = 1, ny = 1) {
  const pos = new Float32Array((nx + 1) * (ny + 1) * 3);
  let k = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let j = 0; j <= ny; j++) {
    const v = j / ny;
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      for (let c = 0; c < 3; c++) {
        const top = tl[c] + (tr[c] - tl[c]) * u;
        const bot = bl[c] + (br[c] - bl[c]) * u;
        pos[k++] = top + (bot - top) * v;
      }
      minY = Math.min(minY, pos[k - 2]);
      maxY = Math.max(maxY, pos[k - 2]);
    }
  }
  const idx = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  return { pos, idx: new Uint16Array(idx), minY, maxY };
}

/** The room: five real surfaces, positioned from the perspective solved off the photograph. */
function roomSurfaces() {
  const L = -WALL_X;
  const R = WALL_X;
  const F = FRONT_Z;
  const B = BACK_Z;
  return [
    {
      name: "ceiling",
      geo: grid([L, CEIL_Y, B], [R, CEIL_Y, B], [R, CEIL_Y, F], [L, CEIL_Y, F], 8, 10),
    },
    {
      name: "leftWall",
      geo: grid([L, CEIL_Y, B], [L, CEIL_Y, F], [L, FLOOR_Y, F], [L, FLOOR_Y, B], 10, 6),
    },
    {
      name: "rightWall",
      geo: grid([R, CEIL_Y, F], [R, CEIL_Y, B], [R, FLOOR_Y, B], [R, FLOOR_Y, F], 10, 6),
    },
    {
      name: "backWall",
      geo: grid([L, CEIL_Y, B], [R, CEIL_Y, B], [R, FLOOR_Y, B], [L, FLOOR_Y, B], 8, 8),
    },
    {
      name: "floor",
      isFloor: true,
      geo: grid([L, FLOOR_Y, B], [R, FLOOR_Y, B], [R, FLOOR_Y, F], [L, FLOOR_Y, F], 10, 14),
    },
  ];
}

/** One occluder: a quad on the card's plane, covering exactly its mask's bounding box. */
function cardGeometry(card, mask) {
  const b = mask.bounds;
  const plane = cardPlane(card);
  const tl = planePoint(plane, b.x0, b.y0);
  const tr = planePoint(plane, b.x1, b.y0);
  const br = planePoint(plane, b.x1, b.y1);
  const bl = planePoint(plane, b.x0, b.y1);
  const n = card.sway ? [10, 14] : [2, 2];
  const geo = grid(tl, tr, br, bl, n[0], n[1]);
  geo.depth = plane.depth;
  return geo;
}

/* ------------------------------------------------------------------ *
 * 7. WebGL plumbing
 * ------------------------------------------------------------------ */

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error("shader: " + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error("link: " + gl.getProgramInfoLog(p));
  }
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { prog: p, u };
}

function makeMesh(gl, geo) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, geo.pos, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: geo.idx.length, minY: geo.minY, maxY: geo.maxY, depth: geo.depth };
}

/** Colour texture with mipmaps + anisotropy — the side walls are seen at a grazing angle. */
function makeImageTexture(gl, source, aniso) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.pname, aniso.max);
  return t;
}

function makeMaskTexture(gl, mask) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.R8,
    mask.w,
    mask.h,
    0,
    gl.RED,
    gl.UNSIGNED_BYTE,
    new Uint8Array(mask.data.buffer, mask.data.byteOffset, mask.data.length)
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return t;
}

/* ------------------------------------------------------------------ *
 * 8. Camera — direct manipulation, inertia, soft limits
 *
 * A truck along the room's x axis with a gentle yaw, never a pan of a flat picture. Travel is
 * bounded because past a certain point the frame would demand scenery the photograph never
 * recorded; the limit is a soft spring, not a wall.
 * ------------------------------------------------------------------ */

class Camera {
  constructor() {
    this.x = 0; // physical position
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.viewX = 0; // smoothed position actually rendered
    this.viewY = 0;
    this.dragging = false;
    this.idle = 0;
    this.motion = 0;
  }

  /** Resistance once the drag pushes past the safe envelope. */
  static resist(v, limit) {
    const over = Math.abs(v) - limit;
    if (over <= 0) return v;
    return Math.sign(v) * (limit + (over * 0.32) / (1 + over * 1.6));
  }

  beginDrag() {
    this.dragging = true;
    this.vx = 0;
    this.vy = 0;
    this.idle = 0;
  }

  /** dx, dy are pointer deltas in fractions of the viewport. */
  drag(dx, dy, dt) {
    const nx = Camera.resist(this.x - dx * TRAVEL_X * 2.35, TRAVEL_X);
    const ny = Camera.resist(this.y + dy * TRAVEL_Y * 2.0, TRAVEL_Y);
    if (dt > 0) {
      // low-passed velocity estimate so a jittery finger does not throw the camera
      this.vx += ((nx - this.x) / dt - this.vx) * 0.35;
      this.vy += ((ny - this.y) / dt - this.vy) * 0.35;
    }
    this.x = nx;
    this.y = ny;
    this.idle = 0;
  }

  endDrag() {
    this.dragging = false;
    this.vx = Math.max(-3.2, Math.min(3.2, this.vx));
    this.vy = Math.max(-1.4, Math.min(1.4, this.vy));
  }

  update(dt, time) {
    if (!this.dragging) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vx *= Math.pow(0.0022, dt); // inertia: glides for roughly a second and a half
      this.vy *= Math.pow(0.0009, dt);

      // soft limit
      const over =
        this.x > TRAVEL_X ? this.x - TRAVEL_X : this.x < -TRAVEL_X ? this.x + TRAVEL_X : 0;
      if (over !== 0) {
        this.vx -= over * 46 * dt;
        this.vx *= Math.pow(0.006, dt);
      }
      // the framing always drifts back to the photographer's eye height
      this.vy -= this.y * 7.5 * dt;

      this.idle += dt;
    }

    // Idle breathing: barely perceptible, so the room never looks frozen.
    let breathe = 0;
    if (this.idle > 4) {
      const r = Math.min(1, (this.idle - 4) / 3.5);
      breathe = (Math.sin(time * 0.29) * 0.011 + Math.sin(time * 0.163 + 1.4) * 0.006) * r;
    }

    const k = 1 - Math.pow(0.0007, dt); // critically-damped feel, ~0.13 s of lag
    this.viewX += (this.x + breathe - this.viewX) * k;
    this.viewY += (this.y + breathe * 0.35 - this.viewY) * k;

    const travel = Math.min(1, Math.abs(this.viewX) / TRAVEL_X + Math.abs(this.viewY) / TRAVEL_Y);
    const speed = Math.min(1, Math.abs(this.vx) * 0.42);
    this.motion +=
      (Math.min(1, travel * 0.85 + speed * 0.45) - this.motion) * (1 - Math.pow(0.05, dt));
  }

  get yaw() {
    // Aim back toward the room's axis, so the composition stays anchored on the hero carpet
    // and the frustum keeps as much of the photograph inside it as possible.
    return Math.atan2(this.viewX * (1 - LOOK_BIAS), LOOK_PIVOT);
  }
}

/* ------------------------------------------------------------------ *
 * 9. Application
 * ------------------------------------------------------------------ */

const boot = document.getElementById("boot");
const bar = document.querySelector("#bar i");
const hint = document.getElementById("hint");
const stage = document.getElementById("stage");
const canvas = document.getElementById("gl");

const progress = (p) => {
  bar.style.width = Math.round(p * 100) + "%";
};
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("could not load " + src));
    im.src = src;
  });
}

async function main() {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: true,
    powerPreference: "high-performance",
  });
  if (!gl) {
    document.getElementById("fail").style.display = "grid";
    boot.classList.add("gone");
    return;
  }

  progress(0.08);
  const photo = await loadImage("gallery.png");
  progress(0.42);
  await nextFrame();

  const masks = CARDS.map(buildMask);
  progress(0.56);
  await nextFrame();

  const backplateCanvas = buildBackplate(photo, masks);
  progress(0.86);
  await nextFrame();

  /* --- resources --- */
  const anisoExt =
    gl.getExtension("EXT_texture_filter_anisotropic") ||
    gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
  const aniso = anisoExt
    ? {
        pname: anisoExt.TEXTURE_MAX_ANISOTROPY_EXT,
        max: Math.min(8, gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT)),
      }
    : null;

  const texPhoto = makeImageTexture(gl, photo, aniso);
  const texPlate = makeImageTexture(gl, backplateCanvas, aniso);

  const scene = program(gl, SCENE_VS, SCENE_FS);
  const post = program(gl, POST_VS, POST_FS);
  const emptyVAO = gl.createVertexArray();

  // Bound to the mask unit while drawing the room, so the render target's own textures are
  // never left attached to a sampler while it is the draw target (WebGL feedback loop).
  const texBlank = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texBlank);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const surfaces = roomSurfaces().map((s) => ({ ...s, mesh: makeMesh(gl, s.geo) }));

  const cards = CARDS.map((card, i) => {
    const mask = masks[i];
    const geo = cardGeometry(card, mask);
    return {
      card,
      mesh: makeMesh(gl, geo),
      depth: geo.depth,
      tex: makeMaskTexture(gl, mask),
      rect: [
        mask.bounds.x0,
        mask.bounds.y0,
        mask.bounds.x1 - mask.bounds.x0,
        mask.bounds.y1 - mask.bounds.y0,
      ],
      phase: i * 2.1,
    };
  }).sort((a, b) => b.depth - a.depth); // painted far to near

  /* --- render target with a depth texture (used by the defocus pass) --- */
  let fbo = null,
    rtColor = null,
    rtDepth = null,
    rbDepth = null,
    depthReadable = false,
    rtW = 0,
    rtH = 0,
    superSample = 1;

  function makeTargets(w, h) {
    if (fbo) {
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(rtColor);
      if (rtDepth) gl.deleteTexture(rtDepth);
      if (rbDepth) gl.deleteRenderbuffer(rbDepth);
      rtDepth = null;
      rbDepth = null;
    }
    rtColor = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, rtColor);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
      gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T])
      gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);

    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rtColor, 0);

    // A readable depth attachment drives the defocus pass. Not every mobile driver accepts
    // every depth format as a texture, so fall back through the alternatives and, failing
    // those, use a plain renderbuffer and switch the defocus off.
    depthReadable = false;
    for (const fmt of [
      [gl.DEPTH_COMPONENT24, gl.UNSIGNED_INT],
      [gl.DEPTH_COMPONENT16, gl.UNSIGNED_SHORT],
    ]) {
      rtDepth = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, rtDepth);
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt[0], w, h, 0, gl.DEPTH_COMPONENT, fmt[1], null);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
        gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
      for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T])
        gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, rtDepth, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
        depthReadable = true;
        break;
      }
      gl.deleteTexture(rtDepth);
      rtDepth = null;
    }
    if (!depthReadable) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, null, 0);
      rbDepth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rbDepth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rbDepth);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    rtW = w;
    rtH = h;
  }

  /* --- layout ---
   * The piece is composed for 9:16. A phone is usually taller than that, so the frame is
   * allowed to overscan and bleed off the edges rather than sit in black bars — but only up to
   * OVERSCAN, which trims at most 10.3% from each side. The hero carpet's fringe starts at
   * x 0.118, so it is never touched. Anything further from 9:16 than that (a desktop window)
   * falls back to a letterboxed panel instead of butchering the composition. */
  const MAX_PIXELS = 3.1e6;
  const OVERSCAN = 1.26;
  function resize() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let w = vw;
    let h = Math.round(w / ASPECT);
    if (h > vh) {
      h = vh;
      w = Math.round(h * ASPECT);
    }
    const need = Math.max(vw / w, vh / h);
    if (need > 1 && need <= OVERSCAN) {
      w = Math.round(w * need);
      h = Math.round(h * need);
    }
    stage.style.width = w + "px";
    stage.style.height = h + "px";
    // whole-pixel placement — a fractional offset would resample the entire frame
    stage.style.left = Math.round((vw - w) / 2) + "px";
    stage.style.top = Math.round((vh - h) / 2) + "px";

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let bw = Math.round(w * dpr);
    let bh = Math.round(h * dpr);
    const fit = Math.min(1, Math.sqrt(MAX_PIXELS / (bw * bh)));
    bw = Math.max(2, Math.round(bw * fit));
    bh = Math.max(2, Math.round(bh * fit));
    canvas.width = bw;
    canvas.height = bh;

    // Supersample only where there is headroom; otherwise the resolve tap is switched off so
    // the resting frame stays a pixel-exact copy of the photograph.
    superSample = bw * bh < MAX_PIXELS * 0.42 ? 1.25 : 1.0;
    makeTargets(Math.round(bw * superSample), Math.round(bh * superSample));
  }
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(resize, 120), { passive: true });
  resize();
  progress(1);

  /* --- input --- */
  const cam = new Camera();
  let pointerId = null;
  let last = { x: 0, y: 0, t: 0 };
  let touched = false;

  const rectW = () => stage.clientWidth || 1;

  stage.addEventListener("pointerdown", (e) => {
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    stage.setPointerCapture(pointerId);
    stage.classList.add("dragging");
    last = { x: e.clientX, y: e.clientY, t: performance.now() };
    cam.beginDrag();
    if (!touched) {
      touched = true;
      hint.classList.remove("on");
    }
  });

  stage.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pointerId) return;
    const now = performance.now();
    const dt = Math.max(0.001, (now - last.t) / 1000);
    cam.drag((e.clientX - last.x) / rectW(), (e.clientY - last.y) / rectW(), dt);
    last = { x: e.clientX, y: e.clientY, t: now };
  });

  const release = (e) => {
    if (e.pointerId !== pointerId) return;
    stage.releasePointerCapture(pointerId);
    pointerId = null;
    stage.classList.remove("dragging");
    cam.endDrag();
  };
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);
  stage.addEventListener("contextmenu", (e) => e.preventDefault());

  // Trackpad / wheel: horizontal scroll walks the gallery too.
  stage.addEventListener(
    "wheel",
    (e) => {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      cam.x = Camera.resist(cam.x + d * 0.0016, TRAVEL_X);
      cam.vx = 0;
      cam.idle = 0;
      if (!touched) {
        touched = true;
        hint.classList.remove("on");
      }
      e.preventDefault();
    },
    { passive: false }
  );

  // Keyboard, for desktop.
  window.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 0.26 : 0.13;
    if (e.key === "ArrowLeft") cam.vx -= step * 6;
    else if (e.key === "ArrowRight") cam.vx += step * 6;
    else return;
    cam.idle = 0;
    e.preventDefault();
  });

  /* --- frame loop --- */
  const proj = homeProjection();
  const homeVP = m4.multiply(proj, m4.view(0, 0, 0, 0));
  const start = performance.now();
  let prev = start;

  function frame(now) {
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    const t = (now - start) / 1000;

    cam.update(dt, t);

    const mvp = m4.multiply(proj, m4.view(cam.viewX, cam.viewY, 0, cam.yaw));
    const motion = cam.motion;
    const swayRamp = Math.min(1, Math.max(0, (t - 0.6) / 2.6));

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, rtW, rtH);
    gl.clearColor(0.0135, 0.0115, 0.0095, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    gl.useProgram(scene.prog);
    gl.uniformMatrix4fv(scene.u.uHomeVP, false, homeVP);
    gl.uniformMatrix4fv(scene.u.uMVP, false, mvp);
    gl.uniform1i(scene.u.uTex, 0);
    gl.uniform1i(scene.u.uMask, 1);
    gl.uniform1f(scene.u.uTime, t);
    gl.uniform1f(scene.u.uSheenX, -cam.viewX * 3.1);

    // 1. the room itself, textured with the photograph minus its occluders
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texBlank);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texPlate);
    gl.uniform1f(scene.u.uUseMask, 0);
    gl.uniform1f(scene.u.uSway, 0);
    for (const s of surfaces) {
      gl.uniform1f(scene.u.uIsFloor, s.isFloor ? 1 : 0);
      gl.uniform1f(scene.u.uMirrorX, s.isFloor ? 1 : 0);
      gl.uniform1f(scene.u.uSheen, s.isFloor ? motion : 0);
      gl.bindVertexArray(s.mesh.vao);
      gl.drawElements(gl.TRIANGLES, s.mesh.count, gl.UNSIGNED_SHORT, 0);
    }

    // 2. the occluders, from the untouched photograph, far to near
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // Each card's lower edge is coplanar with the floor it stands on; bias it forward so the
    // contact line does not z-fight.
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-1.5, -3.0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texPhoto);
    gl.uniform1f(scene.u.uUseMask, 1);
    gl.uniform1f(scene.u.uIsFloor, 0);
    gl.uniform1f(scene.u.uMirrorX, 0);
    gl.uniform1f(scene.u.uSheen, 0);
    gl.uniform1f(scene.u.uEdgeSoft, Math.min(1, motion * 2.4));
    for (const c of cards) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, c.tex);
      gl.uniform4fv(scene.u.uMaskRect, c.rect);
      gl.uniform1f(scene.u.uSway, c.card.sway ? 0.02 * swayRamp : 0);
      gl.uniform2f(scene.u.uSwaySpan, c.mesh.minY, c.mesh.maxY);
      gl.uniform1f(scene.u.uPhase, c.phase);
      gl.bindVertexArray(c.mesh.vao);
      gl.drawElements(gl.TRIANGLES, c.mesh.count, gl.UNSIGNED_SHORT, 0);
    }

    gl.disable(gl.POLYGON_OFFSET_FILL);

    // 3. photographic finish
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(post.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, rtColor);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthReadable ? rtDepth : rtColor);
    gl.uniform1i(post.u.uColor, 0);
    gl.uniform1i(post.u.uDepth, 1);
    gl.uniform2f(post.u.uTexel, 1 / rtW, 1 / rtH);
    gl.uniform1f(post.u.uSuper, superSample > 1.02 ? 0.6 : 0.0);
    gl.uniform1f(post.u.uDof, depthReadable ? motion * 0.85 : 0);
    gl.uniform1f(post.u.uFocus, 5.6);
    gl.uniform1f(post.u.uGrain, motion);
    gl.uniform1f(post.u.uTime, t);
    gl.bindVertexArray(emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
  boot.classList.add("gone");
  setTimeout(() => {
    if (!touched) hint.classList.add("on");
  }, 1500);
  setTimeout(() => hint.classList.remove("on"), 11000);
}

main().catch((err) => {
  console.error(err);
  document.getElementById("fail").style.display = "grid";
  document.getElementById("fail").textContent = String(err.message || err);
  boot.classList.add("gone");
});
