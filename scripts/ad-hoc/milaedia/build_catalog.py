#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MiLAEDiA — مجموعه خصوصی فرش دستباف ایرانی
سازندهٔ قالب اصلی: یک PDF فارسی، راست‌چین و قابل تکمیل.

    python3 build_catalog.py

هرچه لازم است تغییر دهید در بخش CONFIG پایین آمده است.
عکس‌های خودتان را در پوشهٔ photos/ بگذارید تا جای قاب‌های خالی بنشینند.
"""

import os
import sys

import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas

HERE = os.path.dirname(os.path.abspath(__file__))

# ==========================================================================
# CONFIG
# ==========================================================================

OUTPUT = "MiLAEDiA_Persian_Carpet_Collection_FA.pdf"

CARPET_COUNT = 15           # تعداد صفحه‌های فرش
NUMBER_PREFIX = "MiLAEDiA"  # پیش از شمارهٔ هر قطعه چاپ می‌شود
START_NUMBER = 1            # اولین شماره  ->  MiLAEDiA 001
NUMBER_DIGITS = 3           # 3 -> 001 | 4 -> 0001

USE_PLACEHOLDER_IMAGERY = False   # True -> فرش‌های نمونهٔ تولیدشده به جای قاب خالی
FRAME_CAPTIONS = False            # True -> نوشتهٔ راهنما داخل قاب‌های خالی

PHOTOS_DIR = os.path.join(HERE, "photos")
PLATES_DIR = os.path.join(HERE, "plates")
FONTS_DIR = os.path.join(HERE, "fonts")

BRAND = "MiLAEDiA"                              # املای برند — هرگز تغییر نکند
FA_LINE_2 = "مجموعه خصوصی فرش دستباف ایرانی"
FA_LINE_3 = "آلمان · اروپا"
FA_TAGLINE = "فرش نفیس ایرانی، گزیده برای بازار اروپا"

# ==========================================================================

PW, PH = A4
M = 46.0
CW = PW - 2 * M
RIGHT = PW - M                     # لبهٔ راست ستون متن (مبنای راست‌چینی)

CHARCOAL   = HexColor(0x1A1815)
CHAR_SOFT  = HexColor(0x24211C)
IVORY      = HexColor(0xF4EFE6)
IVORY_DEEP = HexColor(0xEBE3D4)
FIELD_BG   = HexColor(0xE7DECD)
CHAMPAGNE  = HexColor(0xC3AC85)
GOLD       = HexColor(0xA3874F)
INK        = HexColor(0x2A2620)
GREY       = HexColor(0x7E7669)
GREY_DK    = HexColor(0x5E5850)
RULE       = HexColor(0xD5CBB7)
RULE_DK    = HexColor(0x3B372F)
ON_DARK    = HexColor(0xEFE8DA)
ON_DARK_D  = HexColor(0x8C8578)

FRAME_BG      = HexColor(0xEFE9DC)
FRAME_BG_DARK = HexColor(0x22201C)
FRAME_LINE    = HexColor(0xD3C9B4)
FRAME_LINE_DK = HexColor(0x3E3A32)
FRAME_BG_RGB      = (239, 233, 220)
FRAME_BG_DARK_RGB = (34, 32, 28)

FONTS = {
    # فارسی — عنوان‌ها (نسخ)
    "Naskh":    "NotoNaskh-400.ttf",
    "Naskh-M":  "NotoNaskh-500.ttf",
    "Naskh-SB": "NotoNaskh-600.ttf",
    # فارسی — متن و برچسب‌ها
    "Vaz-XL":   "Vazirmatn-200.ttf",
    "Vaz-L":    "Vazirmatn-300.ttf",
    "Vaz":      "Vazirmatn-400.ttf",
    "Vaz-M":    "Vazirmatn-500.ttf",
    # لاتین — نام برند و شماره‌ها
    "Corm-L":   "CormorantGaramond-300.ttf",
    "Corm":     "CormorantGaramond-400.ttf",
    "Corm-M":   "CormorantGaramond-500.ttf",
    "Corm-LI":  "CormorantGaramond-300i.ttf",
    "Jost-XL":  "Jost-200.ttf",
    "Jost-L":   "Jost-300.ttf",
}

FIELD_TTF = os.path.join(FONTS_DIR, "Vazirmatn-400.ttf")   # فونت داخل کادرها


def register_fonts():
    for name, fn in FONTS.items():
        pdfmetrics.registerFont(TTFont(name, os.path.join(FONTS_DIR, fn)))


# --------------------------------------------------------------------------
# فارسی‌نویسی: شکل‌دهی حروف + ترتیب راست‌به‌چپ
# --------------------------------------------------------------------------

_RESHAPER = arabic_reshaper.ArabicReshaper(
    arabic_reshaper.config_for_true_type_font(FIELD_TTF))

# نیم‌فاصله (U+200C) در فونت فاصله‌ای تولید نمی‌کند؛ با فاصلهٔ باریک بدون‌شکست
# جایگزین می‌شود که هم پیوند حروف را می‌شکند و هم یک فاصلهٔ کوچک واقعی می‌دهد.
NBTHIN = " "

PERSIAN_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")


def fa(text):
    """متن فارسی را برای چاپ در PDF آماده می‌کند"""
    # base_dir="R" لازم است: سطری که با واژه لاتین شروع شود وگرنه چپ‌چین می‌شود
    return get_display(_RESHAPER.reshape(text.replace("‌", NBTHIN)), base_dir="R")


def pd(value, width=0):
    """عدد را با رقم‌های فارسی برمی‌گرداند"""
    return str(value).zfill(width).translate(PERSIAN_DIGITS)


# --------------------------------------------------------------------------
# ابزار نوشتن
# --------------------------------------------------------------------------

def tw(c, text, font, size, space):
    return c.stringWidth(text, font, size) + space * max(0, len(text) - 1)


def _draw(c, x, y, text, font, size, color, space, align):
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


def P(c, x, y, text, font, size, color, align="r"):
    """متن فارسی — بدون فاصله‌گذاری حروف (پیوند حروف را می‌شکند)"""
    return _draw(c, x, y, fa(text), font, size, color, 0.0, align)


def L(c, x, y, text, font, size, color, space=0.0, align="l"):
    """متن لاتین — با امکان فاصله‌گذاری حروف"""
    return _draw(c, x, y, text, font, size, color, space, align)


def rule(c, x0, y, x1, color=RULE, width=0.5):
    c.setStrokeColor(color)
    c.setLineWidth(width)
    c.line(x0, y, x1, y)


def para(c, x, y, lines, font, size, leading, color):
    for i, line in enumerate(lines):
        P(c, x, y - i * leading, line, font, size, color, align="r")
    return y - (len(lines) - 1) * leading


# --------------------------------------------------------------------------
# کادرهای قابل تکمیل
# --------------------------------------------------------------------------

FIELD_H = 22.0
LABEL_GAP = 10.0
LABEL_SIZE = 8.6
VALUE_SIZE = 12.0

_FIELD_NAMES = []


def label(c, x_right, y, text, color=GREY, size=LABEL_SIZE):
    P(c, x_right, y, text, "Vaz-M", size, color, align="r")


def field(c, name, x, y, w, h=FIELD_H, size=VALUE_SIZE, multiline=False,
          tooltip=None, dark=False, bg=True):
    if bg:
        c.setFillColor(HexColor(0x3A362E) if dark else FIELD_BG)
        c.rect(x, y, w, h, stroke=0, fill=1)
    rule(c, x, y, x + w, HexColor(0x6B6153) if dark else CHAMPAGNE, 0.5)
    _FIELD_NAMES.append(name)
    c.acroForm.textfield(
        name=name, tooltip=tooltip or name,
        x=x + 2.0, y=y + 1.0, width=w - 4.0, height=h - 2.0,
        borderWidth=0, borderColor=None, fillColor=None,
        textColor=ON_DARK if dark else INK,
        forceBorder=False, relative=False, maxlen=0,
        fontName="Helvetica", fontSize=size,
        fieldFlags="multiline" if multiline else "",
        annotationFlags="print",
    )


def labelled(c, name, x_right, y, w, text, h=FIELD_H, size=VALUE_SIZE,
             multiline=False, dark=False):
    label(c, x_right, y + h + LABEL_GAP, text,
          ON_DARK_D if dark else GREY)
    field(c, name, x_right - w, y, w, h, size, multiline, text, dark)


# --------------------------------------------------------------------------
# قاب عکس
# --------------------------------------------------------------------------

def photo_frame(c, x, y, w, h, caption=None, dark=False):
    c.setFillColor(FRAME_BG_DARK if dark else FRAME_BG)
    c.rect(x, y, w, h, stroke=0, fill=1)
    c.setStrokeColor(FRAME_LINE_DK if dark else FRAME_LINE)
    c.setLineWidth(0.5)
    c.rect(x, y, w, h, stroke=1, fill=0)

    o, t = 13.0, 15.0
    c.setStrokeColor(CHAMPAGNE if dark else GOLD)
    c.setLineWidth(0.7)
    for sx, cx0 in ((1, x + o), (-1, x + w - o)):
        for sy, cy0 in ((1, y + o), (-1, y + h - o)):
            c.line(cx0, cy0, cx0 + sx * t, cy0)
            c.line(cx0, cy0, cx0, cy0 + sy * t)

    if FRAME_CAPTIONS and caption:
        col = ON_DARK_D if dark else HexColor(0xA79E8D)
        P(c, x + w / 2.0, y + h / 2.0 - 3, caption, "Vaz-L", 8.5, col, align="c")


# --------------------------------------------------------------------------
# تصاویر
# --------------------------------------------------------------------------

COVER_LOGO = 168.0
COVER_BAND_H = 300.0
PLATE_H = 324.0
PLATE_TOP = 734.0
PLATE_BOT = PLATE_TOP - PLATE_H

EXTS = (".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp", ".heic")


def ensure_imagery(numbers):
    from PIL import Image

    cr = None
    if USE_PLACEHOLDER_IMAGERY:
        import carpet_render as cr  # noqa: F401

    os.makedirs(PLATES_DIR, exist_ok=True)
    os.makedirs(PHOTOS_DIR, exist_ok=True)
    out = {}

    def supplied(stem):
        """۰۰۷.jpg ، 7.jpg ، «7 کاشان.png» — همه شناخته می‌شوند"""
        try:
            files = sorted(os.listdir(PHOTOS_DIR))
        except FileNotFoundError:
            return None
        keys = {stem.lower()}
        if stem.isdigit():
            keys.add(str(int(stem)))
            keys.add(pd(stem))
            keys.add(pd(int(stem)))
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

    def load(src, bg):
        im = Image.open(src)
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            flat = Image.new("RGBA", im.size, bg + (255,))
            im = Image.alpha_composite(flat, im)
        return im.convert("RGB")

    def contain(src, w, h, dst, bg, pad=1.0):
        """کل قطعه دیده می‌شود — هیچ بخشی از فرش بریده نمی‌شود"""
        im = load(src, bg)
        s = min(w * pad / im.width, h * pad / im.height)
        im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))),
                       Image.LANCZOS)
        base = Image.new("RGB", (w, h), bg)
        base.paste(im, ((w - im.width) // 2, (h - im.height) // 2))
        base.save(dst, "JPEG", quality=88, optimize=True)
        return dst

    def cover_crop(src, w, h, dst, bg):
        im = load(src, bg)
        s = max(w / im.width, h / im.height)
        im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))),
                       Image.LANCZOS)
        left, top = (im.width - w) // 2, (im.height - h) // 2
        im.crop((left, top, left + w, top + h)).save(
            dst, "JPEG", quality=88, optimize=True)
        return dst

    S = 2.4

    # لوگو
    src = supplied("logo") or supplied("لوگو")
    if src:
        out["logo"] = contain(src, int(COVER_LOGO * S), int(COVER_LOGO * S),
                              os.path.join(PLATES_DIR, "logo.jpg"),
                              FRAME_BG_DARK_RGB, pad=0.86)
    else:
        out["logo"] = None

    # نوار عکس روی جلد
    src = supplied("cover") or supplied("جلد")
    dst = os.path.join(PLATES_DIR, "cover.jpg")
    if src:
        out["cover"] = cover_crop(src, int(CW * S), int(COVER_BAND_H * S), dst,
                                  FRAME_BG_DARK_RGB)
    elif cr:
        cr.detail(cr.SCHEMES[1], int(CW * S), int(COVER_BAND_H * S), seed=101,
                  knot_px=11, crop=("center", 0.62)).save(dst, "JPEG", quality=90)
        out["cover"] = dst
    else:
        out["cover"] = None

    # نوارهای تصویری داخل کاتالوگ
    for key, (bw, bh, sch, seed, crp) in {
        "band_intro": (CW, 224, 6, 202, ("center", 0.34)),
        "band_supp":  (CW, 196, 3, 203, ("top", 0.30)),
        "band_final": (CW, 150, 8, 204, ("bottom", 0.24)),
    }.items():
        dst = os.path.join(PLATES_DIR, key + ".jpg")
        src = supplied(key)
        if src:
            out[key] = cover_crop(src, int(bw * S), int(bh * S), dst, FRAME_BG_RGB)
        elif cr:
            cr.detail(cr.SCHEMES[sch], int(bw * S), int(bh * S), seed=seed,
                      knot_px=11, crop=crp).save(dst, "JPEG", quality=88)
            out[key] = dst
        else:
            out[key] = None

    # صفحه‌های فرش
    pw_, ph_ = int(CW * S), int(PLATE_H * S)
    for i, num in enumerate(numbers):
        dst = os.path.join(PLATES_DIR, "plate_%s.jpg" % num)
        src = supplied(num)
        if src:
            out[num] = contain(src, pw_, ph_, dst, FRAME_BG_RGB, pad=0.985)
        elif cr:
            sch = cr.SCHEMES[i % len(cr.SCHEMES)]
            cr.plate(sch, pw_, ph_, seed=i * 7 + 3,
                     geometric=(sch["name"] in ("heriz", "serapi"))).save(
                dst, "JPEG", quality=88)
            out[num] = dst
        else:
            out[num] = None
    return out


# --------------------------------------------------------------------------
# چیدمان ستون‌ها — راست به چپ (ستون ۰ سمت راست است)
# --------------------------------------------------------------------------

COL2_W = (CW - 26.0) / 2.0
COL2_R = [RIGHT, RIGHT - COL2_W - 26.0]
COL3_W = (CW - 2 * 20.0) / 3.0
COL3_R = [RIGHT, RIGHT - COL3_W - 20.0, RIGHT - 2 * (COL3_W + 20.0)]


def running_head(c, left_text=None, dark=False):
    y = 806.0
    col = ON_DARK_D if dark else GREY
    w = L(c, RIGHT, y, BRAND, "Corm-M", 10.5, CHAMPAGNE if dark else GOLD,
          3.0, align="r")
    P(c, RIGHT - w - 10, y + 0.5, "· " + FA_LINE_2, "Vaz-L", 7.6, col, align="r")
    if left_text:
        P(c, M, y + 0.5, left_text, "Vaz-L", 7.6, col, align="l")
    rule(c, M, y - 10, RIGHT, RULE_DK if dark else RULE, 0.4)


# --------------------------------------------------------------------------
# صفحه‌ها
# --------------------------------------------------------------------------

def page_cover(c, logo, band):
    c.setFillColor(CHARCOAL)
    c.rect(0, 0, PW, PH, stroke=0, fill=1)
    cx = PW / 2.0

    lx, ly = cx - COVER_LOGO / 2.0, 616.0
    if logo:
        c.drawImage(logo, lx, ly, COVER_LOGO, COVER_LOGO)
    else:
        photo_frame(c, lx, ly, COVER_LOGO, COVER_LOGO, "لوگو", dark=True)

    L(c, cx, 556, BRAND, "Corm-L", 46, ON_DARK, 11.5, align="c")
    rule(c, cx - 35, 528, cx + 35, CHAMPAGNE, 0.6)
    P(c, cx, 494, FA_LINE_2, "Naskh-M", 16, CHAMPAGNE, align="c")
    P(c, cx, 464, FA_LINE_3, "Vaz-L", 10.5, ON_DARK_D, align="c")

    if band:
        c.drawImage(band, M, 104, CW, COVER_BAND_H)
    else:
        photo_frame(c, M, 104, CW, COVER_BAND_H, "عکس جلد", dark=True)

    P(c, cx, 68, FA_TAGLINE, "Naskh", 12.5, HexColor(0x7C7466), align="c")


def page_intro(c, band):
    c.setFillColor(IVORY)
    c.rect(0, 0, PW, PH, stroke=0, fill=1)
    running_head(c)

    P(c, RIGHT, 728, "مجموعه", "Naskh-M", 31, INK, align="r")
    P(c, RIGHT, 686, "خصوصی", "Naskh-M", 31, INK, align="r")
    rule(c, RIGHT - 44, 664, RIGHT, GOLD, 0.8)

    body = [
        "این کاتالوگ، گزیده‌ای خصوصی از فرش دستباف ایرانی را ثبت می‌کند؛",
        "گزیده‌ای که برای مجموعه‌داران، معماران داخلی و مشتریان خصوصی",
        "در اروپا گردآوری شده است.",
        "",
        "هر قطعه جداگانه ثبت می‌شود: محل بافت، نوع بافت، رج، مواد اولیه،",
        "قدمت و وضعیت. این شناسنامه توسط گالری عرضه‌کننده تکمیل و به",
        "عنوان توصیف رسمی قطعه در زمان خرید نگهداری می‌شود.",
    ]
    para(c, RIGHT, 628, body, "Vaz-L", 10.6, 20.0, GREY_DK)

    P(c, RIGHT, 466, "تکمیل این کاتالوگ", "Vaz-M", 9.4, GOLD, align="r")
    rule(c, M, 454, RIGHT, RULE, 0.4)

    steps = [
        ("۱", "این فایل را با Adobe Acrobat Reader (رایگان) یا هر برنامه",
              "PDF جدید روی موبایل یا کامپیوتر باز کنید."),
        ("۲", "مستقیماً داخل کادرهای روشن تایپ کنید. همه کادرها پس از",
              "ذخیره، خوانا و قابل ویرایش باقی می‌مانند."),
        ("۳", "برای هر فرش یک صفحه تکمیل شود. صفحه‌ای که فرشی برای آن",
              "ارائه نمی‌شود خالی بماند؛ صفحه‌ها را حذف نکنید."),
        ("۴", "فایل را ذخیره و بازگردانید. قیمت و ابعاد عمداً خالی گذاشته",
              "شده و باید توسط فروشنده تکمیل شود."),
    ]
    yy = 426
    for numeral, l1, l2 in steps:
        P(c, RIGHT, yy, numeral, "Naskh-M", 15, GOLD, align="r")
        P(c, RIGHT - 26, yy, l1, "Vaz-L", 10.0, GREY_DK, align="r")
        P(c, RIGHT - 26, yy - 16.5, l2, "Vaz-L", 10.0, GREY_DK, align="r")
        yy -= 44

    if band:
        c.drawImage(band, M, 66, CW, 168)
    else:
        photo_frame(c, M, 66, CW, 168)
    rule(c, M, 54, RIGHT, RULE, 0.4)
    P(c, RIGHT, 40, FA_LINE_3, "Vaz-L", 8.0, GREY, align="r")
    P(c, M, 40, "قالب اصلی", "Vaz-L", 8.0, GREY, align="l")


def page_supplier(c, band):
    c.setFillColor(IVORY)
    c.rect(0, 0, PW, PH, stroke=0, fill=1)
    running_head(c, "بخش یک")

    P(c, RIGHT, 744, "اطلاعات فروشنده", "Naskh-M", 27, INK, align="r")
    P(c, RIGHT, 720, "تکمیل توسط گالری، فروشگاه یا کارگاه عرضه‌کننده",
      "Vaz-L", 9.0, GREY, align="r")
    rule(c, M, 704, RIGHT, RULE, 0.5)

    rows = [
        [("supplier_shop_name", "نام فروشگاه / گالری"), ("contact_person", "نام شخص رابط")],
        [("phone_whatsapp", "تلفن / واتس‌اپ"), ("instagram", "اینستاگرام")],
        [("city", "شهر"), ("date", "تاریخ")],
        [("collection_reference", "کد مجموعه"), ("pieces_offered", "تعداد قطعات ارائه‌شده")],
    ]
    y = 632
    for row in rows:
        for i, (name, text) in enumerate(row):
            labelled(c, name, COL2_R[i], y, COL2_W, text, h=24)
        y -= 64

    rule(c, M, 404, RIGHT, RULE, 0.4)
    label(c, RIGHT, 378, "نشانی گالری")
    field(c, "supplier_address", M, 302, CW, 64, multiline=True,
          tooltip="نشانی گالری")

    if band:
        c.drawImage(band, M, 86, CW, 190)
    else:
        photo_frame(c, M, 86, CW, 190)
    rule(c, M, 72, RIGHT, RULE, 0.4)
    P(c, RIGHT, 56, BRAND + " · " + FA_LINE_3, "Vaz-L", 8.0, GREY, align="r")
    P(c, M, 56, "بخش یک · فروشنده", "Vaz-L", 8.0, GREY, align="l")


def page_carpet(c, number, index, total, img):
    c.setFillColor(IVORY)
    c.rect(0, 0, PW, PH, stroke=0, fill=1)
    running_head(c, "قطعه %s از %s" % (pd(index, 2), pd(total, 2)))

    wn = L(c, RIGHT, 762, number, "Jost-XL", 25, INK, 5.2, align="r")
    L(c, RIGHT - wn - 16, 762, NUMBER_PREFIX, "Corm-L", 28, INK, 3.6, align="r")
    rule(c, RIGHT - 36, 746, RIGHT, GOLD, 0.9)
    P(c, M, 762, "شناسنامه قطعه", "Vaz-L", 9.0, GREY, align="l")

    if img:
        c.drawImage(img, M, PLATE_BOT, CW, PLATE_H)
        c.setStrokeColor(HexColor(0xCFC5B0))
        c.setLineWidth(0.5)
        c.rect(M, PLATE_BOT, CW, PLATE_H, stroke=1, fill=0)
    else:
        photo_frame(c, M, PLATE_BOT, CW, PLATE_H,
                    "عکس  ·  %s %s" % (NUMBER_PREFIX, number))

    p = "c%s_" % number
    labelled(c, p + "carpet_name", COL2_R[0], 358, COL2_W, "نام فرش")
    labelled(c, p + "design", COL2_R[1], 358, COL2_W, "طرح / نقشه")

    grid = [
        (306, [("dimensions", "ابعاد"), ("origin", "محل بافت"), ("age", "قدمت")]),
        (254, [("weaving", "نوع بافت"), ("raj", "رج"), ("condition", "وضعیت")]),
        (202, [("warp", "جنس تار"), ("pile", "جنس پرز"), ("availability", "موجودی")]),
    ]
    for y, row in grid:
        for i, (key, text) in enumerate(row):
            labelled(c, p + key, COL3_R[i], y, COL3_W, text)

    label(c, RIGHT, 178, "توضیحات تکمیلی")
    field(c, p + "additional_information", M, 130, CW, 40, size=11,
          multiline=True, tooltip="توضیحات تکمیلی")

    c.setFillColor(IVORY_DEEP)
    c.rect(M, 46, CW, 70, stroke=0, fill=1)
    c.setStrokeColor(CHAMPAGNE)
    c.setLineWidth(0.5)
    c.rect(M, 46, CW, 70, stroke=1, fill=0)

    label(c, RIGHT - 20, 92, "قیمت فروشنده", GREY_DK)
    c.setFillColor(HexColor(0xF7F3EA))
    c.rect(RIGHT - 20 - 300, 56, 300, 25, stroke=0, fill=1)
    field(c, p + "seller_price", RIGHT - 20 - 300, 56, 300, 25, size=13,
          tooltip="قیمت فروشنده", bg=False)
    rule(c, RIGHT - 20 - 300, 56, RIGHT - 20, GOLD, 0.7)

    label(c, M + 152, 92, "واحد پول", GREY_DK)
    c.setFillColor(HexColor(0xF7F3EA))
    c.rect(M + 20, 56, 132, 25, stroke=0, fill=1)
    field(c, p + "currency", M + 20, 56, 132, 25, size=13,
          tooltip="واحد پول", bg=False)
    rule(c, M + 20, 56, M + 152, GOLD, 0.7)


def page_final(c, band):
    c.setFillColor(IVORY)
    c.rect(0, 0, PW, PH, stroke=0, fill=1)
    cx = PW / 2.0

    L(c, cx, 778, BRAND, "Corm-L", 32, INK, 8.5, align="c")
    rule(c, cx - 30, 760, cx + 30, GOLD, 0.7)
    P(c, cx, 734, FA_LINE_2, "Naskh-M", 14, GREY_DK, align="c")
    P(c, cx, 710, FA_LINE_3, "Vaz-L", 9.5, GREY, align="c")
    rule(c, M, 690, RIGHT, RULE, 0.4)

    labelled(c, "supplier_notes", RIGHT, 546, CW, "یادداشت فروشنده",
             h=112, multiline=True)
    labelled(c, "special_conditions", RIGHT, 460, CW, "شرایط ویژه",
             h=54, multiline=True)
    labelled(c, "shipping_information", RIGHT, 366, CW, "اطلاعات ارسال",
             h=54, multiline=True)
    labelled(c, "final_additional_information", RIGHT, 272, CW,
             "توضیحات تکمیلی", h=54, multiline=True)

    if band:
        c.drawImage(band, M, 108, CW, 138)
    else:
        photo_frame(c, M, 108, CW, 138)
    rule(c, M, 94, RIGHT, RULE, 0.4)
    P(c, cx, 72, FA_TAGLINE, "Naskh", 12, GREY, align="c")
    P(c, cx, 50, BRAND + " · " + FA_LINE_3, "Vaz-L", 8.0, GREY, align="c")


# --------------------------------------------------------------------------
# ساخت
# --------------------------------------------------------------------------

def build():
    register_fonts()
    numbers = [str(START_NUMBER + i).zfill(NUMBER_DIGITS) for i in range(CARPET_COUNT)]
    print("آماده‌سازی تصاویر ...")
    img = ensure_imagery(numbers)

    tmp = os.path.join(HERE, ".build.pdf")
    c = rl_canvas.Canvas(tmp, pagesize=A4, pageCompression=1)
    c.setTitle("%s — %s" % (BRAND, FA_LINE_2))
    c.setAuthor(BRAND)
    c.setSubject("شناسنامه مجموعه فرش دستباف ایرانی")
    c.setCreator(BRAND)

    print("چیدن صفحه‌ها ...")
    page_cover(c, img["logo"], img["cover"]);  c.showPage()
    page_intro(c, img["band_intro"]);          c.showPage()
    page_supplier(c, img["band_supp"]);        c.showPage()
    for i, num in enumerate(numbers, start=1):
        page_carpet(c, num, i, len(numbers), img[num]); c.showPage()
    page_final(c, img["band_final"]);          c.showPage()
    c.save()

    finalise(tmp, os.path.join(HERE, OUTPUT))
    os.remove(tmp)
    print("انجام شد ->", OUTPUT)


# --------------------------------------------------------------------------
# پس‌پردازش: فونت فارسی برای کادرها + راست‌چینی + NeedAppearances
# --------------------------------------------------------------------------

def _cid_font(writer, ttf_path, ps_name):
    """یک فونت Type0/Identity-H کامل می‌سازد تا تایپ فارسی داخل کادرها نمایش داده شود"""
    from fontTools.ttLib import TTFont as FT
    from pypdf.generic import (ArrayObject, DecodedStreamObject, DictionaryObject,
                               NameObject, NumberObject)

    ft = FT(ttf_path)
    upm = ft["head"].unitsPerEm
    k = 1000.0 / upm
    order = ft.getGlyphOrder()
    hmtx = ft["hmtx"]
    widths = [int(round(hmtx[g][0] * k)) for g in order]

    raw = open(ttf_path, "rb").read()
    ff = DecodedStreamObject()
    ff.set_data(raw)
    ff[NameObject("/Length1")] = NumberObject(len(raw))
    ff_ref = writer._add_object(ff)

    head, os2, post = ft["head"], ft["OS/2"], ft["post"]
    desc = DictionaryObject({
        NameObject("/Type"): NameObject("/FontDescriptor"),
        NameObject("/FontName"): NameObject("/" + ps_name),
        NameObject("/Flags"): NumberObject(4),
        NameObject("/FontBBox"): ArrayObject([
            NumberObject(int(head.xMin * k)), NumberObject(int(head.yMin * k)),
            NumberObject(int(head.xMax * k)), NumberObject(int(head.yMax * k))]),
        NameObject("/ItalicAngle"): NumberObject(int(post.italicAngle)),
        NameObject("/Ascent"): NumberObject(int(os2.sTypoAscender * k)),
        NameObject("/Descent"): NumberObject(int(os2.sTypoDescender * k)),
        NameObject("/CapHeight"): NumberObject(int(getattr(os2, "sCapHeight", 700) * k)),
        NameObject("/StemV"): NumberObject(80),
        NameObject("/FontFile2"): ff_ref,
    })
    desc_ref = writer._add_object(desc)

    cid = DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/CIDFontType2"),
        NameObject("/BaseFont"): NameObject("/" + ps_name),
        NameObject("/CIDSystemInfo"): DictionaryObject({
            NameObject("/Registry"): __import__("pypdf").generic.TextStringObject("Adobe"),
            NameObject("/Ordering"): __import__("pypdf").generic.TextStringObject("Identity"),
            NameObject("/Supplement"): NumberObject(0)}),
        NameObject("/FontDescriptor"): desc_ref,
        NameObject("/DW"): NumberObject(1000),
        NameObject("/W"): ArrayObject([
            NumberObject(0),
            ArrayObject([NumberObject(w) for w in widths])]),
        NameObject("/CIDToGIDMap"): NameObject("/Identity"),
    })
    cid_ref = writer._add_object(cid)

    t0 = DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type0"),
        NameObject("/BaseFont"): NameObject("/" + ps_name),
        NameObject("/Encoding"): NameObject("/Identity-H"),
        NameObject("/DescendantFonts"): ArrayObject([cid_ref]),
    })
    return writer._add_object(t0)


def finalise(src, dst):
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import (BooleanObject, DictionaryObject, NameObject,
                               NumberObject, TextStringObject)

    reader = PdfReader(src)
    writer = PdfWriter(clone_from=reader)
    root = writer._root_object
    acro = root[NameObject("/AcroForm")]
    acro[NameObject("/NeedAppearances")] = BooleanObject(True)

    # فونت فارسی را به منابع فرم اضافه و به همه کادرها نسبت می‌دهیم
    fa_ref = _cid_font(writer, FIELD_TTF, "Vazirmatn")
    dr = acro.get("/DR")
    if dr is None:
        dr = DictionaryObject()
        acro[NameObject("/DR")] = dr
    dr = dr.get_object()
    fonts = dr.get("/Font")
    if fonts is None:
        fonts = DictionaryObject()
        dr[NameObject("/Font")] = fonts
    fonts.get_object()[NameObject("/PersianFA")] = fa_ref
    acro[NameObject("/DA")] = TextStringObject("/PersianFA 0 Tf 0 g")

    rgb = ".164706 .14902 .12549 rg"
    for page in writer.pages:
        page[NameObject("/Tabs")] = NameObject("/S")
        for a in page.get("/Annots", []):
            an = a.get_object()
            if an.get("/FT") != "/Tx":
                continue
            size = 12
            da = an.get("/DA")
            if da:
                parts = str(da).split()
                for i, tok in enumerate(parts):
                    if tok == "Tf" and i >= 1:
                        try:
                            size = float(parts[i - 1])
                        except ValueError:
                            pass
            an[NameObject("/DA")] = TextStringObject(
                "/PersianFA %g Tf %s" % (size, rgb))
            an[NameObject("/Q")] = NumberObject(2)          # راست‌چین
            if "/AP" in an:
                del an[NameObject("/AP")]

    root[NameObject("/ViewerPreferences")] = DictionaryObject({
        NameObject("/Direction"): NameObject("/R2L")})
    root[NameObject("/Lang")] = TextStringObject("fa-IR")

    writer.add_metadata({
        "/Title": "%s — %s" % (BRAND, FA_LINE_2),
        "/Author": BRAND,
        "/Subject": "شناسنامه مجموعه فرش دستباف ایرانی",
        "/Creator": BRAND,
        "/Producer": BRAND,
    })
    with open(dst, "wb") as fh:
        writer.write(fh)


if __name__ == "__main__":
    sys.path.insert(0, HERE)
    build()
