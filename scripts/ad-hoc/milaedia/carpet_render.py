"""
MiLAEDiA — procedural Persian-carpet plate renderer.

Produces photographic-looking overhead "gallery plates" of hand-knotted Persian
carpets. Used only to populate the MASTER TEMPLATE with placeholder imagery;
drop real photographs into ./photos/ to override (see README).

Method: the design is composed on a knot grid (one cell = one knot), then
up-sampled and given weave texture, abrash, pile sheen and studio lighting.
"""

import math
import numpy as np
from PIL import Image, ImageFilter, ImageDraw

# --------------------------------------------------------------------------
# palette
# --------------------------------------------------------------------------

C = {
    "madder":      (140, 52, 44),
    "madder_dp":   (108, 38, 34),
    "plum":        (104, 40, 48),
    "rust":        (162, 78, 46),
    "terracotta":  (178, 104, 72),
    "indigo":      (36, 52, 78),
    "indigo_dp":   (24, 36, 56),
    "midnight":    (28, 34, 50),
    "teal":        (52, 86, 90),
    "sage":        (110, 120, 96),
    "olive":       (128, 122, 82),
    "camel":       (186, 152, 106),
    "gold":        (176, 142, 84),
    "champagne":   (206, 182, 140),
    "ivory":       (231, 220, 198),
    "ivory_wm":    (222, 206, 176),
    "cream":       (214, 197, 166),
    "rose":        (192, 146, 134),
    "rose_pl":     (206, 172, 158),
    "brown":       (94, 68, 48),
    "walnut":      (78, 56, 42),
    "slate":       (92, 100, 108),
    "aqua":        (128, 158, 158),
    "black":       (32, 28, 26),
}

# role order: field, border, guard, med_a, med_b, med_c, motif_a, motif_b, outline, spandrel
SCHEMES = [
    # 1 Tabriz — madder field, indigo border, ivory medallion
    dict(name="tabriz",   field="madder",    border="indigo",   guard="ivory",
         med_a="ivory",   med_b="indigo",    med_c="madder_dp", motif_a="camel",
         motif_b="ivory", outline="indigo_dp", spandrel="indigo"),
    # 2 Kashan — deep madder, ivory spandrels
    dict(name="kashan",   field="madder_dp", border="indigo_dp", guard="camel",
         med_a="indigo",  med_b="ivory",     med_c="madder",    motif_a="ivory",
         motif_b="rose",  outline="black",   spandrel="ivory"),
    # 3 Isfahan — ivory field
    dict(name="isfahan",  field="ivory",     border="indigo",   guard="madder",
         med_a="indigo",  med_b="camel",     med_c="madder",    motif_a="teal",
         motif_b="rose",  outline="indigo_dp", spandrel="madder"),
    # 4 Nain — pale field, soft blue
    dict(name="nain",     field="ivory_wm",  border="indigo",   guard="ivory",
         med_a="indigo",  med_b="ivory",     med_c="aqua",      motif_a="slate",
         motif_b="camel", outline="indigo_dp", spandrel="indigo"),
    # 5 Kerman — rose & celadon
    dict(name="kerman",   field="rose_pl",   border="plum",     guard="cream",
         med_a="plum",    med_b="cream",     med_c="sage",      motif_a="sage",
         motif_b="gold",  outline="walnut",  spandrel="plum"),
    # 6 Heriz — geometric rust / camel / navy
    dict(name="heriz",    field="rust",      border="midnight", guard="camel",
         med_a="midnight", med_b="camel",    med_c="ivory",     motif_a="ivory",
         motif_b="teal",  outline="black",   spandrel="midnight"),
    # 7 Qum — champagne silk ground
    dict(name="qum",      field="champagne", border="indigo",   guard="gold",
         med_a="indigo",  med_b="gold",      med_c="ivory",     motif_a="teal",
         motif_b="madder", outline="brown",  spandrel="indigo"),
    # 8 Bijar — indigo field, madder medallion
    dict(name="bijar",    field="indigo",    border="madder",   guard="camel",
         med_a="madder",  med_b="ivory",     med_c="gold",      motif_a="camel",
         motif_b="ivory", outline="black",   spandrel="madder"),
    # 9 Sarouk — plum field
    dict(name="sarouk",   field="plum",      border="midnight", guard="cream",
         med_a="cream",   med_b="midnight",  med_c="rose",      motif_a="gold",
         motif_b="cream", outline="black",   spandrel="midnight"),
    # 10 Tabriz sage
    dict(name="verdure",  field="sage",      border="walnut",   guard="champagne",
         med_a="champagne", med_b="walnut",  med_c="terracotta", motif_a="cream",
         motif_b="gold",  outline="black",   spandrel="walnut"),
    # 11 Malayer — camel ground
    dict(name="malayer",  field="camel",     border="indigo_dp", guard="madder",
         med_a="indigo_dp", med_b="ivory",   med_c="madder",    motif_a="madder",
         motif_b="ivory", outline="black",   spandrel="indigo_dp"),
    # 12 Serapi — terracotta
    dict(name="serapi",   field="terracotta", border="teal",    guard="ivory",
         med_a="teal",    med_b="ivory",     med_c="gold",      motif_a="ivory",
         motif_b="midnight", outline="walnut", spandrel="teal"),
]

ROLES = ["field", "border", "guard", "med_a", "med_b", "med_c",
         "motif_a", "motif_b", "outline", "spandrel"]


# --------------------------------------------------------------------------
# knot-grid primitives
# --------------------------------------------------------------------------

def _polar(kh, kw, cy, cx, ry, rx):
    Y, X = np.mgrid[0:kh, 0:kw].astype(np.float64)
    dy = (Y - cy) / ry
    dx = (X - cx) / rx
    return np.sqrt(dx * dx + dy * dy), np.arctan2(dy, dx)


def _lobed(r, th, lobes, depth, phase=0.0):
    """boundary radius of a lobed (cusped) medallion outline"""
    return r < (1.0 + depth * np.cos(lobes * th + phase))


def _stamp_rosette(n=13, lobes=8):
    r, th = _polar(n, n, (n - 1) / 2, (n - 1) / 2, n / 2, n / 2)
    core = _lobed(r * 1.05, th, lobes, 0.22)
    return core


def _stamp_boteh(h=17, w=11):
    Y, X = np.mgrid[0:h, 0:w].astype(np.float64)
    yy = Y / (h - 1)
    xx = (X - (w - 1) / 2) / ((w - 1) / 2)
    # teardrop body that hooks over at the top
    width = np.sqrt(np.clip(1.0 - ((yy - 0.62) / 0.62) ** 2, 0, 1))
    bend = 0.55 * np.clip((0.32 - yy) / 0.32, 0, 1) ** 1.6
    return np.abs(xx - bend) < width * 0.95


def _stamp_palmette(h=13, w=15):
    Y, X = np.mgrid[0:h, 0:w].astype(np.float64)
    yy = (Y - (h - 1) / 2) / ((h - 1) / 2)
    xx = (X - (w - 1) / 2) / ((w - 1) / 2)
    r = np.sqrt(xx * xx + yy * yy)
    th = np.arctan2(yy, xx)
    return r < (0.95 + 0.16 * np.cos(6 * th)) * (0.62 + 0.38 * np.abs(np.cos(th)) ** 0.4)


def _stamp_leaf(h=11, w=7):
    Y, X = np.mgrid[0:h, 0:w].astype(np.float64)
    yy = Y / (h - 1)
    xx = (X - (w - 1) / 2) / ((w - 1) / 2)
    width = np.sin(np.pi * yy) ** 0.75
    return np.abs(xx) < width * 0.92


def _blit(idx, stamp, cy, cx, val, outline=None):
    h, w = stamp.shape
    y0, x0 = int(cy - h // 2), int(cx - w // 2)
    y1, x1 = y0 + h, x0 + w
    H, W = idx.shape
    sy0, sx0 = max(0, -y0), max(0, -x0)
    y0, x0 = max(0, y0), max(0, x0)
    y1, x1 = min(H, y1), min(W, x1)
    if y1 <= y0 or x1 <= x0:
        return
    sub = stamp[sy0:sy0 + (y1 - y0), sx0:sx0 + (x1 - x0)]
    if outline is not None:
        grown = np.zeros_like(sub)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                grown |= np.roll(np.roll(sub, dy, 0), dx, 1)
        idx[y0:y1, x0:x1][grown & ~sub] = outline
    idx[y0:y1, x0:x1][sub] = val


def _ring_outline(mask):
    grown = np.zeros_like(mask)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            grown |= np.roll(np.roll(mask, dy, 0), dx, 1)
    return grown & ~mask


# --------------------------------------------------------------------------
# design
# --------------------------------------------------------------------------

def design_grid(scheme, kw=210, kh=316, seed=0, geometric=False):
    rng = np.random.default_rng(seed)
    P = {r: i for i, r in enumerate(ROLES)}
    idx = np.full((kh, kw), P["field"], dtype=np.uint8)
    Y, X = np.mgrid[0:kh, 0:kw].astype(np.float64)

    # ---- border system -----------------------------------------------------
    sel, g_out, main, g_in = 3, 5, 21, 5
    edges = [(sel, P["outline"]), (g_out, P["guard"]), (main, P["border"]), (g_in, P["guard"])]
    t = 0
    for width, val in edges:
        idx[t:t + width, :] = val
        idx[kh - t - width:kh - t, :] = val
        idx[:, t:t + width] = val
        idx[:, kw - t - width:kw - t] = val
        t += width

    b0 = sel + g_out                  # inner edge of outer guard
    b1 = b0 + main                    # outer edge of inner guard
    bmid_top = b0 + main // 2
    bmid_bot = kh - b1 + main // 2
    bmid_l = b0 + main // 2
    bmid_r = kw - b1 + main // 2

    # running dot motif inside both guard bands
    for gy0, gy1 in ((sel, b0), (b1, b1 + g_in)):
        for off in (0, 1):
            band_rows = [gy0 + 1, gy1 - 2] if off == 0 else []
        for xx in range(sel + 3, kw - sel - 3, 6):
            idx[sel + 1:sel + 3, xx:xx + 2] = P["outline"]
            idx[kh - sel - 3:kh - sel - 1, xx:xx + 2] = P["outline"]
            idx[b1 + 1:b1 + 3, xx:xx + 2] = P["outline"]
            idx[kh - b1 - 3:kh - b1 - 1, xx:xx + 2] = P["outline"]
        for yy in range(sel + 3, kh - sel - 3, 6):
            idx[yy:yy + 2, sel + 1:sel + 3] = P["outline"]
            idx[yy:yy + 2, kw - sel - 3:kw - sel - 1] = P["outline"]
            idx[yy:yy + 2, b1 + 1:b1 + 3] = P["outline"]
            idx[yy:yy + 2, kw - b1 - 3:kw - b1 - 1] = P["outline"]
        break

    # undulating vine through the main border
    per, amp = 25.0, main * 0.26
    vine_h = np.abs(Y - (bmid_top + amp * np.sin(2 * np.pi * X / per))) < 0.9
    vine_h |= np.abs(Y - (bmid_bot + amp * np.sin(2 * np.pi * X / per))) < 0.9
    vine_v = np.abs(X - (bmid_l + amp * np.sin(2 * np.pi * Y / per))) < 0.9
    vine_v |= np.abs(X - (bmid_r + amp * np.sin(2 * np.pi * Y / per))) < 0.9
    in_border = (idx == P["border"])
    idx[(vine_h | vine_v) & in_border] = P["motif_a"]

    # main-border motifs: alternating palmette / rosette / boteh
    rose_s = _stamp_rosette(9, 8)
    palm_s = _stamp_palmette(11, 11)
    bot_s = _stamp_boteh(11, 7)
    seq = [(palm_s, "guard"), (rose_s, "motif_b"), (bot_s, "motif_a"), (rose_s, "guard")]

    step = 25
    xs = list(range(b1 + 12, kw - b1 - 8, step))
    for i, x in enumerate(xs):
        st, role = seq[i % len(seq)]
        _blit(idx, st, bmid_top, x, P[role], outline=P["outline"])
        _blit(idx, np.flipud(st), bmid_bot, x, P[role], outline=P["outline"])
    ys = list(range(b1 + 12, kh - b1 - 8, step))
    for i, y in enumerate(ys):
        st, role = seq[i % len(seq)]
        st_r = np.rot90(st)
        _blit(idx, st_r, y, bmid_l, P[role], outline=P["outline"])
        _blit(idx, np.rot90(st_r, 2), y, bmid_r, P[role], outline=P["outline"])

    # border corner cartouches
    corner = _stamp_rosette(13, 4)
    for cy in (bmid_top, bmid_bot):
        for cx in (bmid_l, bmid_r):
            _blit(idx, corner, cy, cx, P["guard"], outline=P["outline"])
            _blit(idx, _stamp_rosette(5, 6), cy, cx, P["motif_b"])

    # ---- field -------------------------------------------------------------
    fy0, fy1 = t, kh - t
    fx0, fx1 = t, kw - t
    fh, fw = fy1 - fy0, fx1 - fx0
    field_area = (Y >= fy0) & (Y < fy1) & (X >= fx0) & (X < fx1)

    # herati diamond lattice
    lw, lh = (31.0, 31.0) if not geometric else (24.0, 24.0)
    u = (X - fx0) / lw + (Y - fy0) / lh
    v = (X - fx0) / lw - (Y - fy0) / lh
    lat = (np.abs(np.mod(u, 1.0) - 0.5) < 0.030) | (np.abs(np.mod(v, 1.0) - 0.5) < 0.030)
    idx[lat & field_area & (idx == P["field"])] = P["motif_a"]

    # rosettes + leaves on the lattice nodes
    node = _stamp_rosette(9, 8)
    leaf = _stamp_leaf(11, 5)
    ny = int(fh / lh) + 2
    nx = int(fw / lw) + 2
    for iy in range(ny):
        for ix in range(nx):
            yy = fy0 + (iy + 0.5) * lh
            xx = fx0 + (ix + 0.5) * lw
            if not (fx0 + 6 <= xx <= fx1 - 6 and fy0 + 6 <= yy <= fy1 - 6):
                continue
            _blit(idx, node, yy, xx, P["motif_b"])
            _blit(idx, leaf, yy - lh * 0.5, xx, P["motif_a"])
            _blit(idx, np.rot90(leaf), yy, xx - lw * 0.5, P["motif_a"])

    # ---- corner spandrels --------------------------------------------------
    sy, sx = fh * 0.200, fw * 0.265
    for cy, cx in ((fy0 - 1, fx0 - 1), (fy0 - 1, fx1), (fy1, fx0 - 1), (fy1, fx1)):
        r, th = _polar(kh, kw, cy, cx, sy, sx)
        m = _lobed(r, th, 18, 0.030) & field_area
        idx[_ring_outline(m) & field_area] = P["outline"]
        idx[m] = P["spandrel"]
    for cy, cx in ((fy0 + 11, fx0 + 15), (fy0 + 11, fx1 - 15),
                   (fy1 - 11, fx0 + 15), (fy1 - 11, fx1 - 15)):
        _blit(idx, _stamp_palmette(13, 15), cy, cx, P["med_b"], outline=P["outline"])
        _blit(idx, _stamp_rosette(5, 6), cy, cx, P["med_c"])

    # ---- central medallion -------------------------------------------------
    cy, cx = (fy0 + fy1) / 2.0, (fx0 + fx1) / 2.0
    ry, rx = fh * 0.215, fw * 0.255
    lobes = 14 if not geometric else 8
    depth = 0.085 if not geometric else 0.17

    r, th = _polar(kh, kw, cy, cx, ry, rx)
    for frac, role in ((1.00, "med_a"), (0.78, "med_b"), (0.50, "med_c"), (0.22, "med_a")):
        lb = lobes if frac > 0.4 else 8
        dp = depth if frac > 0.4 else 0.22
        m = _lobed(r / frac, th, lb, dp)
        idx[_ring_outline(m)] = P["outline"]
        idx[m] = P[role]

    for k in range(10):
        a = k * 2 * math.pi / 10
        _blit(idx, _stamp_leaf(9, 5), cy + math.sin(a) * ry * 0.36,
              cx + math.cos(a) * rx * 0.36, P["motif_b"])

    # ---- pendants ----------------------------------------------------------
    pend = _stamp_palmette(25, 19)
    for sgn in (-1, 1):
        py = cy + sgn * ry * 1.30
        idx_stem = (np.abs(X - cx) < 1.2) & (np.abs(Y - (cy + sgn * ry * 1.08)) < ry * 0.14)
        idx[idx_stem] = P["outline"]
        _blit(idx, pend, py, cx, P["med_b"], outline=P["outline"])
        _blit(idx, _stamp_rosette(11, 6), py, cx, P["med_c"], outline=P["outline"])

    # a few stray field ornaments for hand-woven irregularity
    for _ in range(int(rng.integers(5, 11))):
        yy = int(rng.integers(fy0 + 8, fy1 - 8))
        xx = int(rng.integers(fx0 + 8, fx1 - 8))
        if idx[yy, xx] == P["field"]:
            _blit(idx, _stamp_leaf(7, 5), yy, xx, P["motif_b"])

    return idx


# --------------------------------------------------------------------------
# knot grid -> photograph
# --------------------------------------------------------------------------

def _smooth_noise(n, scale, rng, amp):
    k = max(2, int(n / scale))
    base = rng.normal(0, 1, k)
    x = np.linspace(0, k - 1, n)
    i0 = np.clip(x.astype(int), 0, k - 1)
    i1 = np.clip(i0 + 1, 0, k - 1)
    f = x - i0
    v = base[i0] * (1 - f) + base[i1] * f
    return 1.0 + amp * v


def render_carpet(scheme, kw=210, kh=316, seed=0, knot_px=5, geometric=False):
    rng = np.random.default_rng(seed + 991)
    idx = design_grid(scheme, kw, kh, seed, geometric)
    pal = np.array([C[scheme[r]] for r in ROLES], dtype=np.float64)
    rgb = pal[idx]

    # per-knot wool jitter + horizontal abrash
    rgb *= (1.0 + rng.normal(0, 0.028, (kh, kw, 1)))
    rgb *= _smooth_noise(kh, 26, rng, 0.030)[:, None, None]
    rgb *= _smooth_noise(kw, 60, rng, 0.014)[None, :, None]
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)

    img = Image.fromarray(rgb, "RGB").resize(
        (kw * knot_px, kh * knot_px), Image.NEAREST)
    W, H = img.size
    a = np.asarray(img).astype(np.float64)

    # weave: weft rows (dark) + warp columns (rounded knot shading)
    yy = np.arange(H)
    xx = np.arange(W)
    weft = 1.0 - 0.10 * (np.mod(yy, knot_px) == 0) - 0.05 * (np.mod(yy, knot_px) == 1)
    warp = 1.0 - 0.075 * np.abs(np.sin(np.pi * (np.mod(xx, knot_px) + 0.5) / knot_px)) ** 3
    warp = warp * (1.0 - 0.06 * (np.mod(xx, knot_px) == 0))
    a *= weft[:, None, None]
    a *= warp[None, :, None]

    # pile sheen: light falls from the top, pile lies toward the viewer
    sheen = np.linspace(1.055, 0.955, H)
    a *= sheen[:, None, None]
    # soft studio falloff at the edges
    gx = 1.0 - 0.10 * (np.abs(np.linspace(-1, 1, W)) ** 3)
    gy = 1.0 - 0.07 * (np.abs(np.linspace(-1, 1, H)) ** 3)
    a *= gx[None, :, None] * gy[:, None, None]
    # fine fibre grain
    a += rng.normal(0, 2.6, (H, W, 1))

    # age the wool: pull chroma down, warm the whole plate, lift the shadows
    lum = a @ np.array([0.299, 0.587, 0.114])
    a = a * 0.80 + lum[:, :, None] * 0.20
    a *= np.array([1.035, 1.000, 0.945])
    a = 14.0 + a * 0.945

    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB")
    img = img.filter(ImageFilter.GaussianBlur(0.7))
    img = img.filter(ImageFilter.UnsharpMask(radius=2, percent=52, threshold=2))
    return img


def with_fringe(carpet, knot_px=6, seed=0):
    """add kilim end + knotted fringe, return RGBA with transparent surround"""
    rng = np.random.default_rng(seed + 17)
    W, H = carpet.size
    fr = int(knot_px * 7.5)
    out = Image.new("RGBA", (W, H + 2 * fr), (0, 0, 0, 0))
    out.paste(carpet.convert("RGBA"), (0, fr))
    d = ImageDraw.Draw(out)
    ivory = (226, 214, 190)
    for x in range(0, W, max(2, knot_px // 2)):
        L = fr * (0.55 + 0.45 * rng.random())
        wob = (rng.random() - 0.5) * knot_px * 1.1
        sh = int(24 * rng.random())
        col = (ivory[0] - sh, ivory[1] - sh, ivory[2] - sh, 255)
        d.line([(x, fr - 1), (x + wob, fr - L)], fill=col, width=1)
        d.line([(x, H + fr), (x + wob, H + fr + L)], fill=col, width=1)
    return out


def plate(scheme, box_w, box_h, seed=0, knot_px=5, kw=210, kh=316,
          geometric=False, fill=0.90, ground=(214, 206, 194)):
    """overhead gallery plate: carpet on a warm studio ground, soft shadow"""
    rng = np.random.default_rng(seed + 313)
    carpet = render_carpet(scheme, kw, kh, seed, knot_px, geometric)
    obj = with_fringe(carpet, knot_px, seed)

    # ground with a soft gradient + grain
    gw, gh = box_w, box_h
    gy = np.linspace(1.06, 0.93, gh)[:, None, None]
    gx = 1.0 - 0.05 * (np.abs(np.linspace(-1, 1, gw)) ** 2)[None, :, None]
    g = np.ones((gh, gw, 3)) * np.array(ground, dtype=np.float64)
    g = g * gy * gx + np.random.default_rng(seed).normal(0, 2.2, (gh, gw, 1))
    base = Image.fromarray(np.clip(g, 0, 255).astype(np.uint8), "RGB").convert("RGBA")

    # fit the carpet inside the plate (landscape presentation)
    obj = obj.rotate(90, expand=True)
    ow, oh = obj.size
    s = min(gw * fill / ow, gh * fill / oh)
    ow, oh = int(ow * s), int(oh * s)
    obj = obj.resize((ow, oh), Image.LANCZOS)
    ox, oy = (gw - ow) // 2, (gh - oh) // 2

    # drop shadow
    sh = Image.new("L", (gw, gh), 0)
    ImageDraw.Draw(sh).rectangle(
        [ox + int(knot_px * 6 * s), oy + int(knot_px * 6 * s),
         ox + ow - int(knot_px * 6 * s), oy + oh - int(knot_px * 6 * s)], fill=96)
    sh = sh.filter(ImageFilter.GaussianBlur(max(6, int(gh * 0.022))))
    shadow = Image.new("RGBA", (gw, gh), (40, 32, 26, 0))
    shadow.putalpha(sh)
    base = Image.alpha_composite(base, shadow.transform(
        shadow.size, Image.AFFINE, (1, 0, 0, 0, 1, -int(gh * 0.012))))

    base.alpha_composite(obj, (ox, oy))
    out = base.convert("RGB")
    return out.filter(ImageFilter.UnsharpMask(radius=1.4, percent=30, threshold=3))


def detail(scheme, box_w, box_h, seed=0, knot_px=9, kw=210, kh=316,
           geometric=False, crop=("center", 0.55)):
    """tight editorial crop — reads as a macro photograph of the pile"""
    carpet = render_carpet(scheme, kw, kh, seed, knot_px, geometric)
    W, H = carpet.size
    mode, frac = crop
    target = box_w / box_h
    ch = int(H * frac)
    cw = int(ch * target)
    if cw > W:
        cw = W
        ch = int(cw / target)
    if mode == "center":
        x0, y0 = (W - cw) // 2, (H - ch) // 2
    elif mode == "top":
        x0, y0 = (W - cw) // 2, int(H * 0.06)
    else:
        x0, y0 = (W - cw) // 2, H - ch - int(H * 0.06)
    im = carpet.crop((x0, y0, x0 + cw, y0 + ch)).resize((box_w, box_h), Image.LANCZOS)
    return im.filter(ImageFilter.UnsharpMask(radius=1.4, percent=34, threshold=3))
