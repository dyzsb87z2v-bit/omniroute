# MiLAEDiA — Private Persian Carpet Collection

Master template for the fillable collection catalogue.

**Output:** `MiLAEDiA_Private_Persian_Carpet_Collection.pdf` — A4, 14 pages, 153 interactive
form fields, openable and editable on phone, tablet and computer.

**The photo frames ship empty.** Every carpet frame, the cover and the three editorial bands
are left blank, waiting for your own photographs — see §3.

```
Cover  ·  The Collection  ·  Supplier Information  ·  MiLAEDiA 001 … 010  ·  Supplier Notes
```

---

## 1 · Sending the catalogue to a seller

Put your carpet photographs in first (§3), then send the PDF as it is. The seller opens it in Adobe Acrobat Reader
(free, iOS / Android / desktop), Apple Books, Preview, Google Drive PDF viewer, Edge or
Chrome, types straight into the shaded fields, saves, and returns the file.

`SELLER PRICE` and `DIMENSIONS` are deliberately empty in the master.

> Tell the seller: **save the file** (not "print to PDF") and send that file back.
> Values typed in are stored in the document and stay readable and editable afterwards.

## 2 · Receiving and archiving

Rename the returned file per supplier and date, e.g.

```
archive/2026-09_Galerie-Shirazi_Hamburg.pdf
```

`COLLECTION REFERENCE` on the Supplier Information page is there to carry your own archive
code, so the number on the page and the number in your archive always match.

To read the answers back out without opening the file:

```bash
python3 -c "from pypdf import PdfReader; f=PdfReader('returned.pdf').get_fields(); \
print('\n'.join(f'{k}: {v.get(\"/V\",\"\")}' for k,v in f.items()))"
```

---

## 3 · Rebuilding the master

```bash
pip install reportlab pypdf pillow numpy
python3 build_catalog.py
```

### Adding your carpet photographs

Drop your image files into `photos/` and run `python3 build_catalog.py` again. The filename
decides which frame the photo lands in:

```
photos/001.jpg      → plate MiLAEDiA 001
photos/002.jpg      → plate MiLAEDiA 002
photos/cover.jpg    → the cover
photos/band_intro.jpg, band_supp.jpg, band_final.jpg   → the three editorial bands
```

Naming is forgiving, so you can copy files straight off a phone or a camera card. For plate
007 all of these are recognised:

```
007.jpg      7.jpg      007-tabriz.jpeg      7 Kashan silk.png
```

`.jpg .jpeg .png .webp .tif .bmp .heic` are accepted. Frames you have no photo for simply
stay empty, so you can add carpets a few at a time and rebuild whenever you like.

Each image is centre-cropped to fill its frame, so **shoot or crop roughly to the frame's
proportion**:

| Frame        | Proportion    | Recommended pixels |
| ------------ | ------------- | ------------------ |
| carpet plate | 1.63 : 1 wide | ≥ 1210 × 740       |
| cover        | 1.12 : 1 wide | ≥ 1430 × 1280      |
| bands        | 2.2–3.4 : 1   | ≥ 1210 × 540       |

#### Without running anything

If you would rather not run the script, the empty frames are also there to be filled by hand:
open the PDF in Acrobat Pro, Canva, Affinity Publisher or Word, place your photograph over a
frame, and export. The register marks in each corner show the exact area a photo should cover.
The form fields keep working — but re-save as PDF, not as images, or the fields are lost.

> `USE_PLACEHOLDER_IMAGERY = True` in the CONFIG block brings back generated demo carpets
> instead of empty frames. Useful for showing the layout, never for a real seller.

### Changing the product numbers or the number of plates

Edit the CONFIG block at the top of `build_catalog.py`:

```python
CARPET_COUNT  = 10          # how many carpet pages
NUMBER_PREFIX = "MiLAEDiA"  # printed before every number
START_NUMBER  = 1           # 1 -> MiLAEDiA 001 ; 41 -> MiLAEDiA 041
NUMBER_DIGITS = 3           # 3 -> 001 ; 4 -> 0001
OUTPUT        = "MiLAEDiA_Private_Persian_Carpet_Collection.pdf"
```

A second seller therefore only needs: a new `photos/` folder, a new `START_NUMBER`, a new
`OUTPUT` name, one command. Form field names follow the printed number (`c001_seller_price`,
`c041_raj`, …), so two catalogues never collide when their data is merged.

---

## 4 · Files

| File                | Purpose                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `build_catalog.py`  | Page layout, typography and the interactive form. CONFIG on top.  |
| `carpet_render.py`  | Optional demo imagery (`USE_PLACEHOLDER_IMAGERY`). Not used in a normal build. |
| `fonts/`            | Cormorant Garamond and Jost (SIL Open Font License 1.1).          |
| `photos/`           | **Your photographs go here.** Empty by default.                  |
| `plates/`           | Build cache — safe to delete, regenerated on every build.        |

## 5 · Fields on each carpet plate

`CARPET NAME · DESIGN · DIMENSIONS · ORIGIN · AGE · WEAVING · RAJ · CONDITION · WARP ·
PILE · AVAILABILITY · ADDITIONAL INFORMATION · SELLER PRICE · CURRENCY`

Supplier Information page: `SUPPLIER / SHOP NAME · CONTACT PERSON · PHONE / WHATSAPP ·
INSTAGRAM · CITY · DATE · COLLECTION REFERENCE · NUMBER OF PIECES OFFERED · ADDRESS / GALLERY`

Final page: `SUPPLIER NOTES · SPECIAL CONDITIONS · SHIPPING INFORMATION · ADDITIONAL INFORMATION`
