# Telegram Image Processor Bot

Send a pile of photos to the bot, press one button, get back a ZIP where every image is cropped
to its subject and rendered on an identical **2000 × 2000** canvas at **JPEG quality 95** — no
stretching, no cut-off subjects.

## Run it

```bash
cd packages/telegram-image-bot
npm install
cp .env.example .env      # paste your @BotFather token into BOT_TOKEN
npm start
```

That is the whole setup. The smart detection works offline — no API key needed.

## What it does to each image

1. **Auto-orients** the photo (EXIF), so rotated phone shots are handled correctly.
2. **Estimates the background** colour from the border ring of the frame.
3. **Builds a content mask** of every pixel that differs from that background (transparent
   pixels count as background).
4. **Groups the content into connected components.** The largest one is the subject.
5. **Drops stray blobs** — small components detached from the subject: captions, page numbers,
   watermarks, catalogue codes. Components that are large, or that touch/neighbour the subject,
   are kept, so multi-part subjects stay intact.
6. **Crops** to the union of everything it kept, plus a small safety pad. The subject can never
   be cut, because the crop box is defined as a box that contains it.
7. **Renders** onto the fixed canvas with `fit: contain` + Lanczos3: aspect ratio preserved,
   letterboxed with the detected background colour, with a configurable margin (default 3%).
8. **Encodes** at quality 95 with 4:4:4 chroma (no colour subsampling) via mozjpeg.

Everything in that list is tunable from `.env` — see the comments there.

## Telegram flow

```
user sends photos      →  📸 25 عکس دریافت شد        [🚀 شروع پردازش]
presses start          →  🤖 AI Processing: 15/25
finishes               →  ✅ 25 عکس پردازش شد        [📦 دریافت ZIP]
presses ZIP            →  processed.zip
```

Photos are collected into a single prompt that is edited in place, so a 100-photo album does not
produce 100 replies. Batches larger than the 50 MB Telegram upload cap are split automatically
into `processed_part1of3.zip`, `processed_part2of3.zip`, … Both compressed photos and
uncompressed image documents are accepted.

Commands: `/start`, `/help`, `/status`, `/reset`.

> **Quality tip:** Telegram re-compresses anything sent as a *photo* down to ~1280 px. Send the
> originals as *files* (documents) and the bot works from the full-resolution source — the bot
> accepts both and says so in its welcome message.

## Behind a proxy

Where `api.telegram.org` is blocked, point the bot at a proxy and both the Telegram connection
and the photo downloads go through it:

```env
PROXY_URL=http://127.0.0.1:2080          # or socks5://user:pass@127.0.0.1:1080
```

If `PROXY_URL` is empty the shell's `HTTPS_PROXY` / `ALL_PROXY` is used when present; set
`PROXY_URL=none` to force a direct connection. Check it before starting the bot:

```bash
npm run check-proxy                       # probes api.telegram.org through the current setting
```

```
proxy: http://127.0.0.1:2080
telegraf agent: configured
probing https://api.telegram.org …

  reachable — HTTP 200
```

## Optional AI layer

Detection has two layers. The heuristic one above always runs. Dropping a key into `.env`:

```env
AI_API_KEY=sk-...
AI_BASE_URL=https://api.openai.com/v1     # or a local OmniRoute instance
AI_MODEL=gpt-4o-mini
```

…turns on a second pass that asks a vision model for the subject's bounding box, which is good at
the cases pixel statistics cannot reason about (busy backgrounds, text printed *on* the subject).
The heuristic subject box stays the floor: the AI can tighten a crop but never shrink it past the
detected subject. If the API is down, slow, or answers with nonsense, the bot logs a warning and
falls back to the heuristic box — a missing or broken key never breaks a batch.

Any OpenAI-compatible `/chat/completions` endpoint works, including OmniRoute itself.

## Development

```bash
npm run selftest                   # detection + rendering assertions on synthetic images
npm run samples -- /tmp/samples    # generate test images (borders, captions, alpha, EXIF)
npm run dryrun -- /tmp/samples     # full Telegram flow with the Bot API stubbed out
npm run try -- /tmp/samples out    # run the real pipeline over a folder, no token needed
```

`npm run try` prints per-image detail, which is the fastest way to tune the detection knobs:

```
ok  1/6 01-product-with-caption.jpg  1600x1200 -> crop 620x480 -> 2000x2000
    [heuristic/trim+cleanup, dropped 20, 155 KB, 715 ms]
```

## Layout

| File              | Role                                                       |
| ----------------- | ---------------------------------------------------------- |
| `src/index.js`    | entry point — validates config, launches long polling       |
| `src/bot.js`      | Telegram handlers, buttons, status messages                 |
| `src/session.js`  | per-chat batch state, temp dirs, idle reaper                |
| `src/pipeline.js` | download + process the batch with a bounded worker pool     |
| `src/process.js`  | crop + resize + encode                                      |
| `src/detect.js`   | heuristic subject detection (background, mask, components)  |
| `src/ai.js`       | optional vision-model refinement                            |
| `src/zip.js`      | ZIP building and part splitting                             |
| `src/config.js`   | every knob, read from `.env`                                |
