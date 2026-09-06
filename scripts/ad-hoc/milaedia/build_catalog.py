#!/usr/bin/env python3
"""
MiLAEDiA — PRIVATE PERSIAN CARPET COLLECTION
Master template builder: produces an interactive, fillable PDF catalogue.

    python3 build_catalog.py

Everything an operator normally needs to change lives in the CONFIG block below.
Real photographs dropped into ./photos/ automatically replace the generated
placeholder plates (see README.md).
"""

import os
import sys

from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas

HERE = os.path.dirname(os.path.abspath(__file__))

# ==========================================================================
# CONFIG  —  the only section an operator needs to touch
# ==========================================================================

OUTPUT = "MiLAEDiA_Private_Persian_Carpet_Collection.pdf"

CARPET_COUNT = 10          # number of carpet plates in the catalogue
NUMBER_PREFIX = "MiLAEDiA" # printed before every product number
START_NUMBER = 1           # first product number  ->  MiLAEDiA 001
NUMBER_DIGITS = 3          # 3 -> 001 / 4 -> 0001

# Photo frames are left EMPTY by default. Drop your own carpet photographs into
# ./photos/ (001.jpg, 002.jpg, cover.jpg ...) and rebuild — each one fills its frame.
# Set this to True only if you want the generated demo carpets back.
USE_PLACEHOLDER_IMAGERY = False

PHOTOS_DIR = os.path.join(HERE, "photos")   # drop 001.jpg, 002.jpg ... here
PLATES_DIR = os.path.join(HERE, "plates")   # generated placeholder imagery
FONTS_DIR = os.path.join(HERE, "fonts")

BRAND = "MiLAEDiA"                          # exact spelling — never alter
LINE_2 = "PRIVATE PERSIAN CARPET COLLECTION"
LINE_3 = "GERMANY · EUROPE"

# ==========================================================================

PW, PH = A4                       # 595.276 x 841.890
M = 46.0                          # left / right margin
CW = PW - 2 * M                   # content width  = 503.276

CHARCOAL   = HexColor(0x1A1815)
CHAR_SOFT  = HexColor(0x272420)
IVORY      = HexColor(0xF4EFE6)
IVORY_DEEP = HexColor(0xEBE3D4)
FIELD_BG   = HexColor(0xE7DECD)
CHAMPAGNE  = HexColor(0xC3AC85)
GOLD       = HexColor(0xA3874F)
INK        = HexColor(0x2A2620)
GREY       = HexColor(0x8B8377)
GREY_DK    = HexColor(0x6B645A)
RULE       = HexColor(0xD5CBB7)
RULE_DK    = HexColor(0x3B372F)
ON_DARK    = HexColor(0xEFE8DA)
ON_DARK_D  = HexColor(0x8C8578)

FONTS = {
    "Corm-L":  "CormorantGaramond-300.ttf",
    "Corm":    "CormorantGaramond-400.ttf",
    "Corm-M":  "CormorantGaramond-500.ttf",
    "Corm-SB": "CormorantGaramond-600.ttf",
    "Corm-I":  "CormorantGaramond-400i.ttf",
    "Corm-LI": "CormorantGaramond-300i.ttf",
    "Jost-XL": "Jost-200.ttf",
    "Jost-L":  "Jost-300.ttf",
    "Jost":    "Jost-400.ttf",
    "Jost-M":  "Jost-500.ttf",
}


def register_fonts():
    for name, fn in FONTS.items():
        pdfmetrics.registerFont(TTFont(name, os.path.join(FONTS_DIR, fn)))


# --------------------------------------------------------------------------
# typographic helpers
# --------------------------------------------------------------------------

def tw(c, text, font, size, space):
    """width of letter-spaced text"""
    return c.stringWidth(text, font, size) + space * max(0, len(text) - 1)


def ls(c, x, y, text, font, size, color, space=0.0, align="l"):
    """draw letter-spaced text; align l | c | r  (x is the anchor)"""
    w = tw(c, text, font, size, space)
    if align == "c":
        x -= w / 2.0
    elif align == "r":
        x -= w
    t = c.beginText(x, y)
    t.setFont(font, size)
    t.setFillColor(color)
    t.setCharSpace(space)
    t.textOut(text)
    c.drawText(t)
    return w


def rule(c, x0, y, x1, color=RULE, width=0.5):
    c.setStrokeColor(color)
    c.setLineWidth(width)
    c.line(x0, y, x1, y)


def para(c, x, y, lines, font, size, leading, color, space=0.0):
    for i, line in enumerate(lines):
        ls(c, x, y - i * leading, line, font, size, color, space)
    return y - (len(lines) - 1) * leading


# --------------------------------------------------------------------------
# form fields
# --------------------------------------------------------------------------

FIELD_H = 19.0
LABEL_GAP = 8.0


def label(c, x, y, text, color=GREY, size=6.2, space=1.55):
    ls(c, x, y, text, "Jost-M", size, color, space)


def field(c, name, x, y, w, h=FIELD_H, size=10.5, multiline=False,
          tooltip=None, dark=False, bg=True):
    """
    A field is drawn as a whisper-light writing area closed by a hairline —
    never as a box. The interactive widget itself is transparent.
    """
    if bg:
        c.setFillColor(HexColor(0x3A362E) if dark else FIELD_BG)
        c.rect(x, y, w, h, stroke=0, fill=1)
    rule(c, x, y, x + w, CHAMPAGNE if not dark else HexColor(0x6B6153), 0.5)
    c.acroForm.textfield(
        name=name,
        tooltip=tooltip or name.replace("_", " ").title(),
        x=x + 2.0, y=y + 1.0, width=w - 4.0, height=h - 2.0,
        borderWidth=0, borderColor=None, fillColor=None,
        textColor=ON_DARK if dark else INK,
        forceBorder=False, relative=False, maxlen=0,
        fontName="Helvetica", fontSize=size,
        fieldFlags="multiline" if multiline else "",
        annotationFlags="print",
    )


def labelled_field(c, name, x, y, w, text, h=FIELD_H, size=10.5,
                   multiline=False, dark=False, tooltip=None):
    label(c, x, y + h + LABEL_GAP, text, GREY if not dark else ON_DARK_D)
    field(c, name, x, y, w, h, size, multiline, tooltip or text, dark)


# --------------------------------------------------------------------------
# imagery
# --------------------------------------------------------------------------

FRAME_BG      = HexColor(0xEFE9DC)
FRAME_BG_DARK = HexColor(0x22201C)
FRAME_LINE    = HexColor(0xD3C9B4)
FRAME_LINE_DK = HexColor(0x3E3A32)


def photo_frame(c, x, y, w, h, caption, dark=False):
    """
    An empty, waiting photograph: soft panel, hairline edge, four register
    marks. Replaced in full the moment a file appears in ./photos/.
    """
    c.setFillColor(FRAME_BG_DARK if dark else FRAME_BG)
    c.rect(x, y, w, h, stroke=0, fill=1)
    c.setStrokeColor(FRAME_LINE_DK if dark else FRAME_LINE)
    c.setLineWidth(0.5)
    c.rect(x, y, w, h, stroke=1, fill=0)

    o, t = 13.0, 15.0                      # inset, tick length
    c.setStrokeColor(CHAMPAGNE if dark else GOLD)
    c.setLineWidth(0.7)
    for sx, cx0 in ((1, x + o), (-1, x + w - o)):
        for sy, cy0 in ((1, y + o), (-1, y + h - o)):
            c.line(cx0, cy0, cx0 + sx * t, cy0)
            c.line(cx0, cy0, cx0, cy0 + sy * t)

    col = ON_DARK_D if dark else HexColor(0xA79E8D)
    ls(c, x + w / 2.0, y + h / 2.0 - 2.5, caption, "Jost-L", 6.4, col, 3.0, align="c")

def ensure_imagery(numbers):
    """
    Returns {key: jpeg path}. A real photograph in ./photos/ always wins:
        photos/001.jpg   ->  plate for MiLAEDiA 001
        photos/cover.jpg ->  cover image
    Anything missing is generated procedurally.
    """
    from PIL import Image

    cr = None
    if USE_PLACEHOLDER_IMAGERY:
        import carpet_render as cr  # noqa: F401

    os.makedirs(PLATES_DIR, exist_ok=True)
    os.makedirs(PHOTOS_DIR, exist_ok=True)
    out = {}

    EXTS = (".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp", ".heic")

    def supplied(stem):
        """
        Forgiving filename matching, so photographs can be dropped in straight
        from a phone or a camera card. For plate 007 all of these work:
            007.jpg   7.jpg   007-tabriz.jpeg   7 Kashan silk.png
        """
        try:
            files = sorted(os.listdir(PHOTOS_DIR))
        except FileNotFoundError:
            return None
        keys = {stem.lower()}
        if stem.isdigit():
            keys.add(str(int(stem)))
        for fn in files:
            base, ext = os.path.splitext(fn)
            if ext.lower() not in EXTS:
                continue
            b = base.strip().lower()
            if b in keys:
                return os.path.join(PHOTOS_DIR, fn)
            for k in keys:
                if b.startswith(k) and not b[len(k):len(k) + 1].isdigit():
                    return os.path.join(PHOTOS_DIR, fn)
        return None

    def fit(src, w, h, dst):
        """cover-crop a supplied photograph to the plate box"""
        im = Image.open(src).convert("RGB")
        sw, sh = im.size
        s = max(w / sw, h / sh)
        im = im.resize((max(1, int(sw * s)), max(1, int(sh * s))), Image.LANCZOS)
        sw, sh = im.size
        im = im.crop(((sw - w) // 2, (sh - h) // 2, (sw - w) // 2 + w, (sh - h) // 2 + h))
        im.save(dst, "JPEG", quality=88, optimize=True)
        return dst

    def fade(im, frac=0.30, color=(26, 24, 21)):
        import numpy as np
        a = np.asarray(im).astype(np.float64)
        h = a.shape[0]
        n = int(h * frac)
        t = np.linspace(0.0, 1.0, n)[:, None, None] ** 1.25
        a[h - n:] = a[h - n:] * (1 - t) + np.array(color) * t
        return Image.fromarray(a.astype("uint8"), "RGB")

    S = 2.4   # render scale -> ~174 dpi

    # ---- cover -------------------------------------------------------------
    cov_w, cov_h = int(PW * S), int(COVER_IMG_H * S)
    dst = os.path.join(PLATES_DIR, "cover.jpg")
    src = supplied("cover")
    if src:
        fit(src, cov_w, cov_h, dst)
        out["cover"] = dst
    elif cr:
        im = cr.detail(cr.SCHEMES[1], cov_w, cov_h, seed=101, knot_px=11,
                       crop=("center", 0.70))
        fade(im, 0.34).save(dst, "JPEG", quality=90, optimize=True)
        out["cover"] = dst
    else:
        out["cover"] = None

    # ---- editorial bands ---------------------------------------------------
    for key, (bw, bh, sch, seed, crp) in {
        "band_intro":  (CW, 224, 6, 202, ("center", 0.34)),
        "band_supp":   (CW, 196, 3, 203, ("top", 0.30)),
        "band_final":  (CW, 150, 8, 204, ("bottom", 0.24)),
    }.items():
        dst = os.path.join(PLATES_DIR, key + ".jpg")
        src = supplied(key)
        if src:
            fit(src, int(bw * S), int(bh * S), dst)
            out[key] = dst
        elif cr:
            cr.detail(cr.SCHEMES[sch], int(bw * S), int(bh * S), seed=seed, knot_px=11,
                      crop=crp).save(dst, "JPEG", quality=88, optimize=True)
            out[key] = dst
        else:
            out[key] = None

    # ---- carpet plates -----------------------------------------------------
    pw_, ph_ = int(CW * S), int(PLATE_H * S)
    for i, num in enumerate(numbers):
        dst = os.path.join(PLATES_DIR, "plate_%s.jpg" % num)
        src = supplied(num)
        if src:
            fit(src, pw_, ph_, dst)
            out[num] = dst
        elif cr:
            sch = cr.SCHEMES[i % len(cr.SCHEMES)]
            cr.plate(sch, pw_, ph_, seed=i * 7 + 3,
                     geometric=(sch["name"] in ("heriz", "serapi")),
                     fill=0.88 + 0.03 * ((i % 3) - 1)).save(
                dst, "JPEG", quality=88, optimize=True)
            out[num] = dst
        else:
            out[num] = None
    return out


# --------------------------------------------------------------------------
# page geometry
# --------------------------------------------------------------------------

COVER_IMG_H = 532.0
PLATE_H = 308.0
PLATE_TOP = 708.0
PLATE_BOT = PLATE_TOP - PLATE_H          # 400

ROW_Y = [346.0, 296.0, 246.0, 196.0]     # field baselines (rect bottoms)
COL2_W = (CW - 26.0) / 2.0
COL2_X = [M, M + COL2_W + 26.0]
COL3_W = (CW - 2 * 22.0) / 3.0
COL3_X = [M, M + COL3_W + 22.0, M + 2 * (COL3_W + 22.0)]


def running_head(c, right_text=None, dark=False):
    y = 800.0
    col = ON_DARK_D if dark else GREY
    x = ls(c, M, y, BRAND, "Corm-M", 9.0, GOLD if not dark else CHAMPAGNE, 3.0)
    ls(c, M + x + 9, y, "· " + LINE_2, "Jost-L", 6.0, col, 1.9)
    if right_text:
        ls(c, PW - M, y, right_text, "Jost-L", 6.0, col, 1.9, align="r")
    rule(c, M, y - 8.5, PW - M, RULE if not dark else RULE_DK, 0.4)


# --------------------------------------------------------------------------
# pages
# --------------------------------------------------------------------------

def page_cover(c, img):
    c.setFillColor(CHARCOAL)
    c.rect(0, 0, PW, PH, stroke=0, fill=1)
    if img:
        c.drawImage(img, 0, PH - COVER_IMG_H, PW, COVER_IMG_H)
    else:
        c.setFillColor(CHAR_SOFT)
        c.rect(0, PH - COVER_IMG_H, PW, COVER_IMG_H, stroke=0, fill=1)
        photo_frame(c, M, PH - COVER_IMG_H + 44, CW, COVER_IMG_H - 88,
                    "COVER PHOTOGRAPH", dark=True)

    cx = PW / 2.0
    ls(c, cx, 214, BRAND, "Corm-L", 47, ON_DARK, 11.5, align="c")
    rule(c, cx - 34, 186, cx + 34, CHAMPAGNE, 0.6)
    ls(c, cx, 158, LINE_2, "Jost-L", 8.6, CHAMPAGNE, 4.6, align="c")
    ls(c, cx, 122, LINE_3, "Jost-L", 7.0, ON_DARK_D, 3.8, align="c")
    ls(c, cx, 74, "Rare Persian carpets — curated for the European market",
       "Corm-LI", 11.5, HexColor(0x7C7466), 1.1, align="c")


def page_intro(c, band):
    c.setFillColor(IVORY)
    c.rect(0, 0, PW, PH, stroke=0, fill=1)
    running_head(c)

    y = 726
    ls(c, M, y, "The", "Corm-L", 30, INK, 1.2)
    ls(c, M, y - 38, "Collection", "Corm-L", 30, INK, 1.2)
    rule(c, M, y - 60, M + 40, GOLD, 0.8)

    left = [
        "This catalogue documents a private selection of hand-knotted",
        "Persian carpets assembled for discerning European collectors,",
        "interior architects and private clients.",
        "",
        "Every piece is recorded individually: origin, weave, knot density,",
        "materials, age and condition. The record is completed by the",
        "supplying gallery and retained by MiLAEDiA as the authoritative",
        "description of the piece at the moment of acquisition.",
    ]
    para(c, M, y - 92, left, "Jost-L", 8.4, 14.6, GREY_DK, 0.12)

    ls(c, M, 496, "COMPLETING THIS CATALOGUE", "Jost-M", 6.6, GOLD, 2.4)
    rule(c, M, 486, PW - M, RULE, 0.4)

    steps = [
        ("I", "Open this file in Adobe Acrobat Reader (free), Apple Books,",
              "Preview, or any modern PDF reader on phone or computer."),
        ("II", "Type directly into the shaded fields. Every field on every",
               "plate remains editable and readable after saving."),
        ("III", "Complete one plate per carpet. Leave a plate blank where",
                "no piece is offered — do not delete pages."),
        ("IV", "Save the file and return it. Prices and dimensions are left",
               "deliberately empty and are to be stated by the supplier."),
    ]
    yy = 460
    for numeral, l1, l2 in steps:
        ls(c, M, yy, numeral, "Corm", 13, GOLD, 1.0)
        ls(c, M + 30, yy, l1, "Jost-L", 8.0, GREY_DK, 0.12)
        ls(c, M + 30, yy - 12.4, l2, "Jost-L", 8.0, GREY_DK, 0.12)
        yy -= 36

    if band:
        c.drawImage(band, M, 68, CW, 224)
    else:
        photo_frame(c, M, 68, CW, 224, "EDITORIAL PHOTOGRAPH")
    rule(c, M, 56, PW - M, RULE, 0.4)
    ls(c, M, 44, LINE_3, "Jost-L", 6.2, GREY, 3.0)
    ls(c, PW - M, 44, "MASTER CATALOGUE", "Jost-L", 6.2, GREY, 3.0, align="r")


def page_supplier(c, band):
    c.setFillColor(IVORY)
    c.rect(0, 0, PW, PH, stroke=0, fill=1)
    running_head(c, "SECTION I")

    ls(c, M, 742, "SUPPLIER INFORMATION", "Corm-L", 27, INK, 3.4)
    ls(c, M, 722, "TO BE COMPLETED BY THE SUPPLYING GALLERY, DEALER OR WORKSHOP",
       "Jost-L", 6.4, GREY, 2.2)
    rule(c, M, 706, PW - M, RULE, 0.5)

    rows = [
        [("supplier_shop_name", "SUPPLIER / SHOP NAME"), ("contact_person", "CONTACT PERSON")],
        [("phone_whatsapp", "PHONE / WHATSAPP"), ("instagram", "INSTAGRAM")],
        [("city", "CITY"), ("date", "DATE")],
        [("collection_reference", "COLLECTION REFERENCE"), ("pieces_offered", "NUMBER OF PIECES OFFERED")],
    ]
    y = 636
    for row in rows:
        for i, (name, text) in enumerate(row):
            labelled_field(c, name, COL2_X[i], y, COL2_W, text, h=21, size=11)
        y -= 62

    rule(c, M, 412, PW - M, RULE, 0.4)
    label(c, M, 388, "ADDRESS / GALLERY", GREY)
    field(c, "supplier_address", M, 316, CW, 62, size=10.5, multiline=True,
          tooltip="Address / Gallery")

    if band:
        c.drawImage(band, M, 92, CW, 196)
    else:
        photo_frame(c, M, 92, CW, 196, "EDITORIAL PHOTOGRAPH")
    rule(c, M, 76, PW - M, RULE, 0.4)
    ls(c, M, 60, BRAND + " · " + LINE_3, "Jost-L", 6.2, GREY, 2.6)
    ls(c, PW - M, 60, "SECTION I · SUPPLIER", "Jost-L", 6.2, GREY, 2.6, align="r")


def page_carpet(c, number, index, total, img):
    c.setFillColor(IVORY)
    c.rect(0, 0, PW, PH, stroke=0, fill=1)
    running_head(c, "PLATE %02d / %02d" % (index, total))

    wm = ls(c, M, 738, NUMBER_PREFIX, "Corm-L", 27, INK, 3.6)
    ls(c, M + wm + 16, 738, number, "Jost-XL", 24, INK, 5.2)
    rule(c, M, 724, M + 34, GOLD, 0.9)
    ls(c, PW - M, 738, "SINGLE PIECE RECORD", "Jost-L", 6.2, GREY, 2.4, align="r")

    if img:
        c.drawImage(img, M, PLATE_BOT, CW, PLATE_H)
        c.setStrokeColor(HexColor(0xCFC5B0))
        c.setLineWidth(0.5)
        c.rect(M, PLATE_BOT, CW, PLATE_H, stroke=1, fill=0)
    else:
        photo_frame(c, M, PLATE_BOT, CW, PLATE_H,
                    "PHOTOGRAPH  ·  %s %s" % (NUMBER_PREFIX, number))

    p = "c%s_" % number
    # row A — two columns
    labelled_field(c, p + "carpet_name", COL2_X[0], ROW_Y[0], COL2_W, "CARPET NAME")
    labelled_field(c, p + "design", COL2_X[1], ROW_Y[0], COL2_W, "DESIGN")
    # rows B–D — three columns
    grid = [
        [("dimensions", "DIMENSIONS"), ("origin", "ORIGIN"), ("age", "AGE")],
        [("weaving", "WEAVING"), ("raj", "RAJ"), ("condition", "CONDITION")],
        [("warp", "WARP"), ("pile", "PILE"), ("availability", "AVAILABILITY")],
    ]
    for r, row in enumerate(grid):
        for i, (key, text) in enumerate(row):
            labelled_field(c, p + key, COL3_X[i], ROW_Y[r + 1], COL3_W, text)

    # additional information
    label(c, M, 174, "ADDITIONAL INFORMATION")
    field(c, p + "additional_information", M, 126, CW, 40, size=10,
          multiline=True, tooltip="Additional information")

    # price band
    c.setFillColor(IVORY_DEEP)
    c.rect(M, 46, CW, 66, stroke=0, fill=1)
    c.setStrokeColor(CHAMPAGNE)
    c.setLineWidth(0.5)
    c.rect(M, 46, CW, 66, stroke=1, fill=0)
    label(c, M + 20, 92, "SELLER PRICE", GREY_DK)
    c.setFillColor(HexColor(0xF7F3EA))
    c.rect(M + 20, 58, 300, 22, stroke=0, fill=1)
    c.rect(M + 352, 58, 131, 22, stroke=0, fill=1)
    field(c, p + "seller_price", M + 20, 58, 300, 22, size=12,
          tooltip="Seller price", bg=False)
    rule(c, M + 20, 58, M + 320, GOLD, 0.7)
    label(c, M + 352, 92, "CURRENCY", GREY_DK)
    field(c, p + "currency", M + 352, 58, 131, 22, size=12,
          tooltip="Currency", bg=False)
    rule(c, M + 352, 58, M + 483, GOLD, 0.7)

    ls(c, PW / 2.0, 32, BRAND, "Corm-M", 7.5, GREY, 2.8, align="c")


def page_final(c, band):
    c.setFillColor(IVORY)
    c.rect(0, 0, PW, PH, stroke=0, fill=1)
    cx = PW / 2.0

    ls(c, cx, 772, BRAND, "Corm-L", 31, INK, 8.5, align="c")
    rule(c, cx - 28, 754, cx + 28, GOLD, 0.7)
    ls(c, cx, 732, LINE_2, "Jost-L", 7.8, GREY_DK, 4.2, align="c")
    ls(c, cx, 712, LINE_3, "Jost-L", 6.4, GREY, 3.4, align="c")
    rule(c, M, 690, PW - M, RULE, 0.4)

    labelled_field(c, "supplier_notes", M, 548, CW, "SUPPLIER NOTES",
                   h=112, size=10.5, multiline=True)
    labelled_field(c, "special_conditions", M, 466, CW, "SPECIAL CONDITIONS",
                   h=52, size=10.5, multiline=True)
    labelled_field(c, "shipping_information", M, 374, CW, "SHIPPING INFORMATION",
                   h=52, size=10.5, multiline=True)
    labelled_field(c, "final_additional_information", M, 282, CW,
                   "ADDITIONAL INFORMATION", h=52, size=10.5, multiline=True)

    if band:
        c.drawImage(band, M, 104, CW, 150)
    else:
        photo_frame(c, M, 104, CW, 150, "EDITORIAL PHOTOGRAPH")
    rule(c, M, 88, PW - M, RULE, 0.4)
    ls(c, cx, 66, "Rare Persian carpets — curated for the European market",
       "Corm-LI", 10.5, GREY, 0.9, align="c")
    ls(c, cx, 46, BRAND + " · " + LINE_3, "Jost-L", 6.0, GREY, 2.8, align="c")


# --------------------------------------------------------------------------
# build
# --------------------------------------------------------------------------

def build():
    register_fonts()
    numbers = [str(START_NUMBER + i).zfill(NUMBER_DIGITS) for i in range(CARPET_COUNT)]
    print("rendering imagery ...")
    img = ensure_imagery(numbers)

    tmp = os.path.join(HERE, ".build.pdf")
    c = rl_canvas.Canvas(tmp, pagesize=A4, pageCompression=1)
    c.setTitle("%s — %s" % (BRAND, LINE_2))
    c.setAuthor(BRAND)
    c.setSubject("Private Persian carpet collection — supplier record")
    c.setKeywords("Persian carpets, private collection, MiLAEDiA, Germany, Europe")
    c.setCreator(BRAND)

    print("composing pages ...")
    page_cover(c, img["cover"]);            c.showPage()
    page_intro(c, img["band_intro"]);       c.showPage()
    page_supplier(c, img["band_supp"]);     c.showPage()
    for i, num in enumerate(numbers, start=1):
        page_carpet(c, num, i, len(numbers), img[num]); c.showPage()
    page_final(c, img["band_final"]);       c.showPage()
    c.save()

    finalise(tmp, os.path.join(HERE, OUTPUT))
    os.remove(tmp)
    print("done ->", OUTPUT)


def finalise(src, dst):
    """
    Turn on /NeedAppearances so every viewer — including iOS/Android and
    browser readers — regenerates field appearances, which is what keeps
    typed values visible after the seller saves the file.
    """
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import BooleanObject, NameObject

    reader = PdfReader(src)
    writer = PdfWriter(clone_from=reader)
    root = writer._root_object
    acro = root[NameObject("/AcroForm")]
    acro[NameObject("/NeedAppearances")] = BooleanObject(True)
    writer.add_metadata({
        "/Title": "%s — %s" % (BRAND, LINE_2),
        "/Author": BRAND,
        "/Subject": "Private Persian carpet collection — supplier record",
        "/Creator": BRAND,
        "/Producer": BRAND,
    })
    with open(dst, "wb") as fh:
        writer.write(fh)


if __name__ == "__main__":
    sys.path.insert(0, HERE)
    build()
