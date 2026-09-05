/*
 * MiLAEDiA — the showroom render, walkable.
 *
 * The hall photograph is projected onto a coarse metric reconstruction of the room solved from
 * the image itself, so moving the camera transforms the photograph geometrically instead of
 * redrawing anything. The five alcoves are pinned to the very wall planes the photograph is
 * painted on, which is what makes it impossible for a carpet to drift off its wall.
 *
 * Derived from the research build in the OmniRoute repo
 * (scripts/ad-hoc/persian-carpet-gallery). That version also handles a furnished hall, which
 * needs silhouette masks and an inpainted backplate; an empty room needs none of it, so this
 * is the reduced engine: five planes, one draw pass, no post-processing.
 *
 * ---- how the numbers were measured ----
 * horizon 0.4423  Alcoves 1 and 2 are the same panel on the left wall at different depths.
 *                 Their image heights differ by 1.431x, and the top and bottom edges each give
 *                 the same horizon independently.
 * field 1.40      A 70 degree vertical field. It makes the centre alcove 1.51 x 2.77 m sitting
 *                 0.71 m off the floor, and puts the ceiling/back-wall junction at image row
 *                 0.301 — exactly where that alcove begins.
 * walls +-1.30 m  Places the wall/back-wall corners at image x 0.335 and 0.665, inside the
 *                 dark pillars, so no alcove is ever split by a seam.
 */

const IMG_W = 768;
const IMG_H = 1376;
const ASPECT = IMG_W / IMG_H;

const HORIZON = 0.4423;
const FIELD = 1.4;
const EYE = 1.55;
const FLOOR_Y = -EYE;
const CEIL_Y = 2.0;
const WALL_X = 1.3;
const BACK_Z = -10.1;
const FRONT_Z = 1.0;
const NEAR = 0.1;
const FAR = 60.0;

/* The nearest alcove is only ~3.4 m away and these alcoves hold real stock, so the travel is
 * deliberately short: far enough to read as a room you walk through, not so far that a piece
 * swings out of frame. */
const TRAVEL_X = 0.34;
const TRAVEL_Y = 0.08;
const LOOK_BIAS = 0.18;
const LOOK_PIVOT = 7.2;

/* The site's own alcove rectangles, in its GalleryHall order:
 * far left, near left, centre, near right, far right. */
export const ALCOVES = [
  { rect: [0.148, 0.368, 0.198, 0.484], plane: "left" },
  { rect: [0.006, 0.336, 0.09, 0.502], plane: "left" },
  { rect: [0.384, 0.306, 0.576, 0.502], plane: "back" },
  { rect: [0.91, 0.336, 0.994, 0.502], plane: "right" },
  { rect: [0.802, 0.368, 0.852, 0.484], plane: "right" },
];

/* ---------------------------------------------------------------- math ---- */

const m4 = {
  /** Off-axis ("shift lens") frustum — the render's horizon sits above centre while every
   *  vertical stays vertical, which is a shifted projection, not a tilted camera. */
  frustum(l, r, b, t, n, f) {
    // prettier-ignore
    return new Float32Array([
      (2 * n) / (r - l), 0, 0, 0,
      0, (2 * n) / (t - b), 0, 0,
      (r + l) / (r - l), (t + b) / (t - b), -(f + n) / (f - n), -1,
      0, 0, (-2 * f * n) / (f - n), 0,
    ]);
  },
  multiply(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++)
        o[c * 4 + r] =
          a[r] * b[c * 4] +
          a[4 + r] * b[c * 4 + 1] +
          a[8 + r] * b[c * 4 + 2] +
          a[12 + r] * b[c * 4 + 3];
    return o;
  },
  /** Yaw only: no pitch and no roll, so the render's vertical lines stay vertical. */
  view(x, y, yaw) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return new Float32Array([c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, -x * c, -y, -x * s, 1]);
  },
};

function homeProjection() {
  const hx = 0.5 * ASPECT * FIELD * NEAR;
  return m4.frustum(-hx, hx, (HORIZON - 1) * FIELD * NEAR, HORIZON * FIELD * NEAR, NEAR, FAR);
}

/** Image point (x, y in 0..1, y down) back-projected to `depth` metres ahead. */
function unproject(ix, iy, depth) {
  return [(ix - 0.5) * ASPECT * FIELD * depth, (HORIZON - iy) * FIELD * depth, -depth];
}

const PLANES = {
  left: () => ({ n: [1, 0, 0], c: -WALL_X, depth: WALL_X }),
  right: () => ({ n: [1, 0, 0], c: WALL_X, depth: WALL_X }),
  back: () => ({ n: [0, 0, 1], c: BACK_Z, depth: -BACK_Z }),
};

function planePoint(plane, ix, iy) {
  const d = unproject(ix, iy, 1);
  const denom = plane.n[0] * d[0] + plane.n[2] * d[2];
  if (Math.abs(denom) < 1e-5) return unproject(ix, iy, plane.depth);
  const t = plane.c / denom;
  if (!(t > 0.05)) return unproject(ix, iy, plane.depth);
  return [d[0] * t, d[1] * t, d[2] * t];
}

function alcoveCorners(a) {
  const plane = PLANES[a.plane]();
  const [x0, y0, x1, y1] = a.rect;
  return [
    planePoint(plane, x0, y0),
    planePoint(plane, x1, y0),
    planePoint(plane, x1, y1),
    planePoint(plane, x0, y1),
  ];
}

/** Projective map taking the box (0,0)-(w,h) onto four screen points, as a CSS matrix3d. */
function quadMatrix(q, w, h) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const sx1 = x1 - x2;
  const sx2 = x3 - x2;
  const sx3 = x0 - x1 + x2 - x3;
  const sy1 = y1 - y2;
  const sy2 = y3 - y2;
  const sy3 = y0 - y1 + y2 - y3;
  const den = sx1 * sy2 - sx2 * sy1;
  if (!den) return null;
  const g = (sx3 * sy2 - sx2 * sy3) / den;
  const h2 = (sx1 * sy3 - sx3 * sy1) / den;
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + h2 * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + h2 * y3;
  return `matrix3d(${a / w},${d / w},0,${g / w},${b / h},${e / h},0,${h2 / h},0,0,1,0,${x0},${y0},0,1)`;
}

/* ------------------------------------------------------------- shaders ---- */

const VS = `#version 300 es
precision highp float;
in vec3 aPos;
uniform mat4 uMVP;
uniform mat4 uHomeVP;
out vec4 vProj;
out vec3 vWorld;
void main() {
  vProj = uHomeVP * vec4(aPos, 1.0);
  vWorld = aPos;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec4 vProj;
in vec3 vWorld;
uniform sampler2D uTex;
uniform float uIsFloor;
uniform float uSheen;
uniform float uSheenX;
out vec4 outColor;
const vec3 VOID_COLOR = vec3(0.010, 0.009, 0.008);
void main() {
  // Perspective divide of the home-camera projection recovers the exact source pixel. At the
  // home pose the two matrices are identical, so every fragment resolves to itself.
  float wRaw = vProj.w;
  float front = step(0.0005, wRaw);
  float w = max(abs(wRaw), 1.0e-3);
  vec3 ndc = vProj.xyz / w;
  vec2 iuv = vec2(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);

  // Rolls off only OUTSIDE the photograph, so inside the frame the image is untouched.
  const float F = 0.17;
  vec2 f = smoothstep(-F, 0.0, iuv) * (1.0 - smoothstep(1.0, 1.0 + F, iuv));
  float inside = f.x * f.y * front;

  vec3 col = texture(uTex, clamp(iuv, 0.0, 1.0)).rgb;
  if (uIsFloor > 0.5 && uSheen > 0.0) {
    float band = exp(-pow((vWorld.x - uSheenX) * 0.9, 2.0));
    float reach = smoothstep(-9.5, -2.0, vWorld.z) * smoothstep(-0.6, -1.8, vWorld.z);
    col *= 1.0 + uSheen * band * reach * 0.16;
  }
  outColor = vec4(mix(VOID_COLOR, col, 0.13 + 0.87 * inside), 1.0);
}`;

/* ------------------------------------------------------------------ gl ---- */

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

function buildProgram(gl) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { prog: p, u };
}

/** Bilinear grid over four world-space corners, given TL, TR, BR, BL. */
function grid(tl, tr, br, bl, nx, ny) {
  const pos = new Float32Array((nx + 1) * (ny + 1) * 3);
  let k = 0;
  for (let j = 0; j <= ny; j++) {
    const v = j / ny;
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      for (let c = 0; c < 3; c++) {
        const top = tl[c] + (tr[c] - tl[c]) * u;
        const bot = bl[c] + (br[c] - bl[c]) * u;
        pos[k++] = top + (bot - top) * v;
      }
    }
  }
  const idx = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  return { pos, idx: new Uint16Array(idx) };
}

function makeMesh(gl, geo) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, geo.pos, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: geo.idx.length };
}

/** The room: five real planes. The hall is a box shot down its own axis, so floor, ceiling and
 *  walls are actual surfaces — which is why the alcoves keystone correctly instead of sliding. */
function roomSurfaces(gl) {
  const L = -WALL_X;
  const R = WALL_X;
  const F = FRONT_Z;
  const B = BACK_Z;
  return [
    {
      floor: false,
      mesh: makeMesh(
        gl,
        grid([L, CEIL_Y, B], [R, CEIL_Y, B], [R, CEIL_Y, F], [L, CEIL_Y, F], 6, 8)
      ),
    },
    {
      floor: false,
      mesh: makeMesh(
        gl,
        grid([L, CEIL_Y, B], [L, CEIL_Y, F], [L, FLOOR_Y, F], [L, FLOOR_Y, B], 8, 6)
      ),
    },
    {
      floor: false,
      mesh: makeMesh(
        gl,
        grid([R, CEIL_Y, F], [R, CEIL_Y, B], [R, FLOOR_Y, B], [R, FLOOR_Y, F], 8, 6)
      ),
    },
    {
      floor: false,
      mesh: makeMesh(
        gl,
        grid([L, CEIL_Y, B], [R, CEIL_Y, B], [R, FLOOR_Y, B], [L, FLOOR_Y, B], 6, 6)
      ),
    },
    {
      floor: true,
      mesh: makeMesh(
        gl,
        grid([L, FLOOR_Y, B], [R, FLOOR_Y, B], [R, FLOOR_Y, F], [L, FLOOR_Y, F], 8, 12)
      ),
    },
  ];
}

/* -------------------------------------------------------------- camera ---- */

class Camera {
  constructor() {
    this.x = this.y = this.vx = this.vy = 0;
    this.viewX = this.viewY = 0;
    this.dragging = false;
    this.idle = 0;
    this.motion = 0;
  }
  static resist(v, limit) {
    const over = Math.abs(v) - limit;
    if (over <= 0) return v;
    return Math.sign(v) * (limit + (over * 0.32) / (1 + over * 1.6));
  }
  begin() {
    this.dragging = true;
    this.vx = this.vy = 0;
    this.idle = 0;
  }
  drag(dx, dy, dt) {
    const nx = Camera.resist(this.x - dx * TRAVEL_X * 2.35, TRAVEL_X);
    const ny = Camera.resist(this.y + dy * TRAVEL_Y * 2.0, TRAVEL_Y);
    if (dt > 0) {
      this.vx += ((nx - this.x) / dt - this.vx) * 0.35;
      this.vy += ((ny - this.y) / dt - this.vy) * 0.35;
    }
    this.x = nx;
    this.y = ny;
    this.idle = 0;
  }
  end() {
    this.dragging = false;
    this.vx = Math.max(-2.2, Math.min(2.2, this.vx));
    this.vy = Math.max(-1.2, Math.min(1.2, this.vy));
  }
  update(dt, time) {
    if (!this.dragging) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vx *= Math.pow(0.0022, dt);
      this.vy *= Math.pow(0.0009, dt);
      const over =
        this.x > TRAVEL_X ? this.x - TRAVEL_X : this.x < -TRAVEL_X ? this.x + TRAVEL_X : 0;
      if (over !== 0) {
        this.vx -= over * 46 * dt;
        this.vx *= Math.pow(0.006, dt);
      }
      this.vy -= this.y * 7.5 * dt;
      this.idle += dt;
    }
    let breathe = 0;
    if (this.idle > 4) {
      const r = Math.min(1, (this.idle - 4) / 3.5);
      breathe = (Math.sin(time * 0.29) * 0.008 + Math.sin(time * 0.163 + 1.4) * 0.004) * r;
    }
    const k = 1 - Math.pow(0.0007, dt);
    this.viewX += (this.x + breathe - this.viewX) * k;
    this.viewY += (this.y - this.viewY) * k;
    const travel = Math.min(1, Math.abs(this.viewX) / TRAVEL_X);
    this.motion += (travel - this.motion) * (1 - Math.pow(0.05, dt));
  }
  get yaw() {
    return Math.atan2(this.viewX * (1 - LOOK_BIAS), LOOK_PIVOT);
  }
}

/* --------------------------------------------------------------- mount ---- */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    // WebGL will not upload a cross-origin image that was not fetched with CORS, and the hall
    // render is served from the Base44 file host.
    im.crossOrigin = "anonymous";
    im.decoding = "async";
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("could not load the hall render"));
    im.src = src;
  });
}

/**
 * Mount the walkable hall into `root`.
 *
 *   const hall = mountHall(el, { src: settings.hallRenderPortrait });
 *   hall.alcoves  // five elements, warped onto their walls every frame — render into these
 *   hall.destroy()
 *
 * Everything is scoped to `root`: it measures its own container, listens on its own element,
 * passes vertical scroll straight through to the page, and stops rendering off screen.
 */
export function mountHall(root, options = {}) {
  const doc = root.ownerDocument;
  const stage = doc.createElement("div");
  // pan-y, not none: the hall can fill a whole screen, and a page that navigates by scrolling
  // would become unusable on a phone if the hall swallowed vertical touches. The browser keeps
  // vertical panning; horizontal drags are left to us for the camera.
  const touchAction = options.touchAction || "pan-y";
  stage.style.cssText = `position:absolute;left:0;top:0;margin:0;padding:0;cursor:grab;touch-action:${touchAction}`;
  const canvas = doc.createElement("canvas");
  canvas.style.cssText = "display:block;width:100%;height:100%;max-width:none;max-height:none";
  stage.appendChild(canvas);
  root.appendChild(stage);

  const alcoves = ALCOVES.map((a) => {
    const el = doc.createElement("div");
    el.style.cssText =
      "position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform;backface-visibility:hidden";
    el.style.width = `${Math.round((a.rect[2] - a.rect[0]) * IMG_W)}px`;
    el.style.height = `${Math.round((a.rect[3] - a.rect[1]) * IMG_H)}px`;
    el.hidden = true;
    stage.appendChild(el);
    return el;
  });

  const off = [];
  let disposed = false;
  const on = (el, type, fn, opts) => {
    el.addEventListener(type, fn, opts);
    off.push(() => el.removeEventListener(type, fn, opts));
  };

  const handle = {
    alcoves,
    ready: null,
    destroy() {
      disposed = true;
      for (const f of off.splice(0)) {
        try {
          f();
        } catch {
          /* a listener whose node is already gone is not an error */
        }
      }
      stage.remove();
    },
  };

  handle.ready = start(root, stage, canvas, alcoves, options, on, off, () => disposed).catch(
    (err) => {
      console.error("[MiLAEDiA hall]", err);
      throw err;
    }
  );
  return handle;
}

async function start(root, stage, canvas, alcoveEls, options, on, off, isDisposed) {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: true, depth: true });
  if (!gl) throw new Error("WebGL 2 is required");

  const photo = await loadImage(options.src);
  if (isDisposed()) return;

  // The reconstruction was solved from one specific render. If a different one is ever put in
  // its place, its proportions will not match and every alcove would land in the wrong spot, so
  // bail and let the caller fall back to the flat hall rather than show carpets off their walls.
  const shot = photo.naturalWidth / photo.naturalHeight;
  if (Math.abs(shot - ASPECT) > 0.01) {
    throw new Error(
      `hall render is ${photo.naturalWidth}x${photo.naturalHeight} (aspect ${shot.toFixed(4)}); ` +
        `the reconstruction expects ${ASPECT.toFixed(4)}`
    );
  }

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, photo);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
  // The side walls are seen at a grazing angle, where anisotropy is the difference between
  // crisp marble and mush.
  const ext =
    gl.getExtension("EXT_texture_filter_anisotropic") ||
    gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
  if (ext)
    gl.texParameterf(
      gl.TEXTURE_2D,
      ext.TEXTURE_MAX_ANISOTROPY_EXT,
      Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT))
    );

  const prog = buildProgram(gl);
  const surfaces = roomSurfaces(gl);
  const alcoveGeom = ALCOVES.map((a, i) => ({
    el: alcoveEls[i],
    corners: alcoveCorners(a),
    w: Math.max(1, Math.round((a.rect[2] - a.rect[0]) * IMG_W)),
    h: Math.max(1, Math.round((a.rect[3] - a.rect[1]) * IMG_H)),
  }));

  /* Letterboxed inside whatever box the host gives it, unless the host supplies its own
   * framing. `options.layout(vw, vh, aspect)` returns { w, h, left, top } in CSS pixels, which
   * lets a page that already zooms and crops its hall keep exactly that composition — the
   * alcoves follow, because they are projected into this same box. */
  const MAX_PIXELS = 3.5e6;
  let stageW = 0;
  let stageH = 0;
  function resize() {
    const vw = Math.max(2, root.clientWidth);
    const vh = Math.max(2, root.clientHeight);

    let box = typeof options.layout === "function" ? options.layout(vw, vh, ASPECT) : null;
    if (!box || !(box.w > 0) || !(box.h > 0)) {
      let w = vw;
      let h = Math.round(w / ASPECT);
      if (h > vh) {
        h = vh;
        w = Math.round(h * ASPECT);
      }
      box = { w, h, left: (vw - w) / 2, top: (vh - h) / 2 };
    }

    stageW = Math.max(2, Math.round(box.w));
    stageH = Math.max(2, Math.round(box.h));
    stage.style.width = `${stageW}px`;
    stage.style.height = `${stageH}px`;
    // whole-pixel placement: a fractional offset resamples the entire frame
    stage.style.left = `${Math.round(box.left)}px`;
    stage.style.top = `${Math.round(box.top)}px`;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(stageW * dpr);
    const bh = Math.round(stageH * dpr);
    const fit = Math.min(1, Math.sqrt(MAX_PIXELS / (bw * bh)));
    canvas.width = Math.max(2, Math.round(bw * fit));
    canvas.height = Math.max(2, Math.round(bh * fit));
  }
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(resize);
    ro.observe(root);
    off.push(() => ro.disconnect());
  } else {
    on(window, "resize", resize, { passive: true });
  }
  resize();

  /* ---- input ---- */
  const cam = new Camera();
  let pointerId = null;
  let last = { x: 0, y: 0, t: 0 };
  const width = () => stage.clientWidth || 1;

  // Suppressing mousedown's default keeps the browser from scrolling this tall element into
  // view when it takes focus, and stops text selection. Clicks still reach alcove content.
  on(stage, "mousedown", (e) => e.preventDefault());
  on(stage, "pointerdown", (e) => {
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    stage.setPointerCapture(pointerId);
    stage.style.cursor = "grabbing";
    last = { x: e.clientX, y: e.clientY, t: performance.now() };
    cam.begin();
    options.onFirstTouch?.();
  });
  on(stage, "pointermove", (e) => {
    if (e.pointerId !== pointerId) return;
    const now = performance.now();
    cam.drag(
      (e.clientX - last.x) / width(),
      (e.clientY - last.y) / width(),
      Math.max(0.001, (now - last.t) / 1000)
    );
    last = { x: e.clientX, y: e.clientY, t: now };
  });
  const release = (e) => {
    if (e.pointerId !== pointerId) return;
    stage.releasePointerCapture(pointerId);
    pointerId = null;
    stage.style.cursor = "grab";
    cam.end();
  };
  on(stage, "pointerup", release);
  on(stage, "pointercancel", release);
  // A vertical wheel is deliberately left alone: an embedded section must never capture the
  // page's scroll. Only a horizontal trackpad swipe walks the hall.
  on(
    stage,
    "wheel",
    (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      cam.x = Camera.resist(cam.x + e.deltaX * 0.0016, TRAVEL_X);
      cam.vx = 0;
      cam.idle = 0;
      options.onFirstTouch?.();
      e.preventDefault();
    },
    { passive: false }
  );

  /* ---- frame loop ---- */
  const proj = homeProjection();
  const homeVP = m4.multiply(proj, m4.view(0, 0, 0));
  const t0 = performance.now();
  let prev = t0;
  let raf = 0;
  let running = false;

  function frame(now) {
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    cam.update(dt, (now - t0) / 1000);

    const mvp = m4.multiply(proj, m4.view(cam.viewX, cam.viewY, cam.yaw));

    for (const a of alcoveGeom) {
      const pts = [];
      let ok = true;
      for (const p of a.corners) {
        const cw = mvp[3] * p[0] + mvp[7] * p[1] + mvp[11] * p[2] + mvp[15];
        if (cw <= 1e-4) {
          ok = false;
          break;
        }
        const cx = mvp[0] * p[0] + mvp[4] * p[1] + mvp[8] * p[2] + mvp[12];
        const cy = mvp[1] * p[0] + mvp[5] * p[1] + mvp[9] * p[2] + mvp[13];
        pts.push([
          (cx / cw) * 0.5 * stageW + stageW * 0.5,
          stageH * 0.5 - (cy / cw) * 0.5 * stageH,
        ]);
      }
      const matrix = ok ? quadMatrix(pts, a.w, a.h) : null;
      if (matrix) {
        a.el.style.transform = matrix;
        if (a.el.hidden) a.el.hidden = false;
      } else if (!a.el.hidden) {
        a.el.hidden = true;
      }
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.01, 0.009, 0.008, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(prog.prog);
    gl.uniformMatrix4fv(prog.u.uHomeVP, false, homeVP);
    gl.uniformMatrix4fv(prog.u.uMVP, false, mvp);
    gl.uniform1i(prog.u.uTex, 0);
    gl.uniform1f(prog.u.uSheenX, -cam.viewX * 3.1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    for (const s of surfaces) {
      gl.uniform1f(prog.u.uIsFloor, s.floor ? 1 : 0);
      gl.uniform1f(prog.u.uSheen, s.floor ? cam.motion : 0);
      gl.bindVertexArray(s.mesh.vao);
      gl.drawElements(gl.TRIANGLES, s.mesh.count, gl.UNSIGNED_SHORT, 0);
    }

    raf = requestAnimationFrame(frame);
  }

  // A hall scrolled past should cost nothing.
  const startLoop = () => {
    if (running || isDisposed()) return;
    running = true;
    prev = performance.now();
    raf = requestAnimationFrame(frame);
  };
  const stopLoop = () => {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  off.push(stopLoop);
  if (typeof IntersectionObserver === "function") {
    const vis = new IntersectionObserver((es) => (es[0].isIntersecting ? startLoop() : stopLoop()));
    vis.observe(root);
    off.push(() => vis.disconnect());
  }
  startLoop();
  options.onReady?.();
}
