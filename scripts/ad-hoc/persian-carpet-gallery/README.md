# MiLAEDiA — interactive Persian carpet gallery

A single photograph of a Persian carpet gallery, turned into a space you can walk through with
your finger. The photograph is the only source of pixels: nothing is redrawn, restyled or
generated, and no carpet is ever recreated.

Open `index.html` over HTTP (`npx serve .`, or any static server — `file://` will not work
because the texture is read back through a canvas).

```
scripts/ad-hoc/persian-carpet-gallery/
├── index.html             markup, styling, loading screen
├── gallery.js             the whole engine — raw WebGL 2, no dependencies
├── gallery.png            the reference photograph, 941 × 1672, untouched
├── embed-demo.html        reference: the gallery inside a page section
└── build-standalone.mjs   bundles it into one self-contained file
```

`node build-standalone.mjs` inlines the styles, the engine and the photograph (as a data URI)
into a single 3.3 MB HTML file with nothing to fetch at runtime — drop it on any static host.

The photograph stays PNG on purpose. At JPEG q98 the compression error is 1.50/255, roughly
fifteen times the whole render pipeline's error against the source (0.10/255); it would become
the dominant loss in a piece whose entire premise is that the carpets are untouched.

---

## Embedding it in a site

The gallery mounts inside whatever element you give it and touches nothing around it. Two lines
in the carpet collection section:

```html
<div id="carpet-collection" data-milaedia-gallery data-src="/assets/gallery.png"></div>
<script src="/assets/gallery.js" defer></script>
```

Upload `gallery.js` and `gallery.png` next to each other and point `data-src` at the photograph.
Every element carrying `data-milaedia-gallery` is mounted automatically; a page that builds its
own DOM can call `MilaediaGallery.mount(el, { src })` instead and keep the returned handle, which
has a `destroy()` for single-page-app teardown.

`embed-demo.html` is a working reference — the gallery sitting in a section of an ordinary
(right-to-left, Persian) page, with product cards below it.

**Sizing.** Give the container a height and it is obeyed. Give it none and the gallery presents
itself as a portrait panel — `aspect-ratio: 9/16`, capped at `88vh` and centred — which is what
puts a vertical showroom in the middle of a desktop page. Override with `data-aspect="4/5"` or
`data-max-height="70vh"`.

**What it will not do to your page.** It sizes to its own container rather than the window, so it
reflows correctly inside a column or a drawer. A vertical wheel or trackpad scroll passes
straight through — only a horizontal swipe moves the camera — so the section never captures the
page's scroll. Arrow keys work only while the gallery has focus, and taking focus never scrolls
the page. Its styles are confined to `.mlg-*` class names, and every property a host theme tends
to set globally (`box-sizing`, `canvas { width }`, `max-width`) is stated explicitly so a
surrounding stylesheet cannot disturb the layout.

**What it costs before you scroll to it: nothing.** Neither the photograph nor the WebGL context
is created until the section is within about one and a half screens of the viewport, and
rendering stops completely whenever it scrolls out of view.

**Fonts.** The embed requests none — it uses `Cormorant Garamond` and `Jost` if the host page
already provides them and a real fallback stack otherwise. Point it at your own typography with
`--mlg-font` and `--mlg-display-font` on the container. `index.html` does load those two from
Google Fonts, but non-blocking on purpose: a stylesheet in `<head>` holds up script execution,
and `fonts.googleapis.com` is unreachable on some networks, which would stall the gallery itself
and not merely its lettering.

**When you do not control the page.** On a hosted store theme where you cannot add a script,
build the single file and put it in an iframe — complete CSS and JS isolation, immune to whatever
the theme does:

```html
<iframe
  src="/assets/milaedia-standalone.html"
  title="Persian carpet gallery"
  loading="lazy"
  style="width: 100%; max-width: 495px; aspect-ratio: 9/16; border: 0; display: block; margin-inline: auto;"
></iframe>
```

---

## How the carpets survive

Every surface is drawn with **projective texture mapping from the original camera**. The vertex
shader projects each rest-pose vertex through the home view-projection matrix; the fragment
shader divides by `w` and gets the exact image coordinate that surface point occupied in the
photograph.

At the home pose `uMVP == uHomeVP`, so every fragment resolves to itself and the frame _is_ the
photograph. Move the camera and the photograph stays glued to the geometry like a
projector-mapped set — a carpet's pixels are transformed by a homography, never regenerated,
never re-tinted, never warped by an animation.

Rendered headlessly at the source's native 941 × 1672 and diffed against the file, at rest
before any animation begins — whole frame, nothing excluded but the swipe hint overlay:

| metric                           | value          |
| -------------------------------- | -------------- |
| mean absolute error              | **0.15 / 255** |
| pixels differing by more than 8  | **0.11 %**     |
| pixels differing by more than 32 | **0.005 %**    |

---

## The perspective, solved from the image

Nothing here was guessed; each number was read back out of the photograph.

**Horizon at y = 0.355.** The hero carpet is a rectangle on the floor, so the ratio of its image
half-widths equals the ratio of its distances from the horizon. It spans x 0.132→0.868 at
y = 0.745 and x 0.349→0.651 at y = 0.515 — a width ratio of 2.437, which forces the horizon to
y = 0.355.

**A shift lens, not a tilt.** The horizon sits above centre while every vertical in the frame
stays vertical. A tilted camera would converge them, so this is an off-axis frame, and it is
reproduced with an asymmetric frustum (`top = 0.355·T·n`, `bottom = −0.645·T·n`). No fisheye, no
edge stretching.

**Vertical field T = 1.446 per unit depth** (≈ 70° V / 44° H, a 24 mm full-frame look), fixed by
solving the hero carpet to a plausible 1.65 × 3.95 m. **Eye height 1.55 m.**

Two independent checks confirmed the model rather than merely fitting it:

- A ceiling at +2.25 m reaches image row y = 0.182 at 9 m depth — exactly where the MiLAEDiA
  banner's top edge sits. The banner hangs from the ceiling at 9 m, and correctly occludes the
  ceiling behind it, just as in the photograph.
- A back wall at 12.4 m makes the far lit carpet 1.27 × 2.43 m with its hem 7 cm off the floor.

---

## Depth structure

**Real reconstructed surfaces.** The room is a box shot down its own axis, so the floor, ceiling
and walls are actual planes, not cards. This is what makes the movement read as space rather
than as sliding layers: the hero carpet lies _on_ the floor plane and its perspective genuinely
changes as you move; the hanging carpets are _coplanar with the walls_, so their keystone
corrects itself geometrically and they need no cards at all.

| surface           | placement             | carries                                     |
| ----------------- | --------------------- | ------------------------------------------- |
| floor             | y = −1.55, z +1 → −13 | hero carpet, marble, baked reflections      |
| ceiling           | y = +2.25             | beams, track lights                         |
| left / right wall | x = ±2.80             | hanging carpets, portrait, "AUTHENTIC" sign |
| back wall         | z = −12.4             | far lit carpet, corridor                    |

The wall/back-wall corners land at image x 0.2225 and 0.7775 — chosen so they fall inside the
dark column gaps, where no hanging carpet can ever be split by a seam.

**Cards, only for what stands in front of a surface.** Each is a quad on the vertical plane
containing its traced floor-contact line, so the near platforms are correctly oriented receding
planes rather than flat billboards — the left one runs from 4.2 m at the frame edge to 6.7 m at
its inner corner.

| card                           | depth    | parallax                  |
| ------------------------------ | -------- | ------------------------- |
| stackLeftNear / stackRightNear | ~4–6.7 m | strongest                 |
| stackLeftFar / stackRightFar   | ~6.8 m   | medium                    |
| plantLeft / plantRight         | 7.7 m    | medium, plus foliage sway |
| MiLAEDiA banner                | 8.7 m    | slight                    |

---

## Filling what the photograph never saw

Step sideways and you look behind things. Two mechanisms cover that, and both only ever move
pixels that already exist.

**Backplate inpaint.** The room surfaces are textured with the photograph minus its occluders.
Holes are filled by a push-pull pyramid with weighted bilinear prolongation — it diffuses
neighbouring real pixels, it does not invent artwork. The fill is computed at half resolution
and composited back over the full-resolution photograph, so every pixel outside a hole is
untouched. The core of each hole is shaded, because everything it covers is floor the object was
standing in front of: in a real gallery that is the object's own shadow, and a reveal then reads
as depth rather than as a bright smear.

**Camera envelope.** Lateral travel is capped at ±0.55 m with a soft spring, and the camera keeps
aiming slightly back toward the room's axis as it trucks. That counter-yaw costs nothing in
parallax — parallax comes from the translation — but it swings the frustum edge back inside the
photograph. With `LOOK_BIAS = 0.18` and a 7.2 m pivot, everything past ~7 m stays fully covered.

Past the frame edge the periphery rolls off over a long ramp into the gallery's shadow instead of
hitting a black wall. The near floor, which is plain dark marble at both edges, is continued by
mirroring existing pixels outward; the fold is clamped to 10 % of the frame, and the hero
carpet's nearest fringe corner is at x 0.118 / 0.878, so no carpet can ever be duplicated.

---

## Camera and interaction

Truck along the room's x axis with a gentle yaw — never a pan across a flat picture.

- **Swipe left** → the camera moves toward the right side of the gallery. **Swipe right** → left.
- Direct manipulation while dragging, with resistance past the envelope; inertia on release that
  glides for about a second and a half; a critically-damped follow with ~0.13 s of lag.
- Vertical drag lifts or lowers the eye by up to 10 cm and always springs back to the
  photographer's height.
- Mouse drag, trackpad and wheel, and arrow keys all work. Pointer Events, so touch and mouse
  share one path.
- After four seconds idle the camera breathes by about a centimetre, so the room is never frozen.

---

## Materials and life

Deliberately very quiet, and every effect is scaled by camera motion so the **resting frame is
the photograph and nothing else**.

- **Polished floor** — a broad soft reflection of the room lighting that slides as you move,
  over the reflections already baked into the marble.
- **Foliage** — the two plants sway a couple of pixels, rooted at the pot and free at the fronds.
  Texture coordinates come from the rest pose, so the leaves bend and the image bends with them.
  Ramped in over the first seconds so the opening frame is exact.
- **Defocus** — depth-driven, from a real depth texture, capped at 2.3 px. The hero carpet sits
  at the focus distance and stays sharp. The photograph already carries its own depth of field,
  so this only adds the defocus earned by moving.
- **Grain** — 1.4 % maximum, motion-scaled.

---

## Layout

Composed for 9:16. A phone is usually taller, so the frame overscans and bleeds off the edges
rather than sitting in black bars — but only up to 1.26×, which trims at most 10.3 % from each
side. The hero carpet's fringe starts at x 0.118, so it is never touched. A window further from
9:16 than that falls back to a letterboxed panel instead of butchering the composition.

## Performance

Raw WebGL 2, no libraries, nothing fetched at runtime beyond the photograph. Twelve draw calls of
large quads plus one post pass; the render target is capped at 3.1 MP with the device pixel ratio
capped at 2. Loads and builds its masks and backplate in well under a second. Mipmaps and
anisotropic filtering are on because the side walls are seen at a grazing angle.

If the driver will not give a readable depth attachment, the code falls back through
`DEPTH_COMPONENT16` to a plain renderbuffer and switches the defocus off. WebGL 2 is required.

## Known limits

Honest ones, inherent to reconstructing a space from one photograph:

- Travel is bounded. Push past the envelope and the spring pushes back, because past it the frame
  would need scenery the photograph never recorded.
- The near display platforms are approximated by one plane each. They are volumetric objects, so
  at the extremes of travel their silhouettes flatten slightly.
- Reveals behind the near platforms show diffused floor, not real floor. It reads as shadow, but
  it is a fill.
- The corridor behind the back wall is painted into that plane, so its depth does not parallax.
  It is small, far, and moves very little.
