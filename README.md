# electro-temerin 🧲🎶

A **magnetic theremin** that runs entirely in the browser. Pitch is controlled by the
[Generic Sensor API `Magnetometer`](https://developer.mozilla.org/en-US/docs/Web/API/Magnetometer) —
wave a fridge magnet near your phone to play it — while volume and articulation come from
touch. Sound is synthesized live with the Web Audio API. No build step, no dependencies,
no tracking.

**Live demo:** host it yourself in one click — see [Deploy](#deploy-to-cloudflare-pages).

![stack](https://img.shields.io/badge/stack-html%20%2B%20js%20%2B%20css-blue)
![runtime](https://img.shields.io/badge/dev%20server-bun-black)
![hosting](https://img.shields.io/badge/hosting-cloudflare%20pages-orange)
![license](https://img.shields.io/badge/license-MIT-green)

## How it works

1. The phone's magnetometer reports the ambient magnetic field vector `(x, y, z)` in µT.
2. You **calibrate** once (holding still, away from metal) to capture Earth's baseline field (~25–65 µT).
3. Bringing a magnet closer adds 100+ µT of deviation. That delta is mapped to a pitch position
   across 1–5 octaves from a chosen root note, with optional quantization to a musical scale.
4. A Web Audio oscillator (sine/triangle/saw/square) glides to that pitch through a lowpass
   filter and a touch of echo. A hold-to-sound gate (or drone mode) controls articulation,
   and an on-screen pad supplies volume — X axis — and doubles as a full fallback instrument.

## Features

- 🧲 **Magnetometer pitch** — field-strength (`Δ|B|`) or single-axis (`ΔX/ΔY/ΔZ`) sources, polarity flip, µT range and smoothing controls
- 🎹 **Musical voice** — 4 waveforms, glissando or 5 quantized scales (chromatic, major, natural minor, major/minor pentatonic), root + octave span, portamento glide, vibrato LFO, lowpass cutoff, echo
- 👆 **Touch-pad fallback** — X = volume, Y = pitch; mouse / trackpad / touchscreen compatible, overrides the sensor while touching. Hover + two-finger scroll plays too (vertical = pitch, horizontal or Shift+scroll = volume) without scrolling the page — Chromebook-friendly
- 🔬 **Live readouts** — X/Y/Z/|B| bars, baseline + ΔµT, note name + Hz + MIDI, waveform scope
- 🤖 **Simulate mode** — self-playing virtual magnet for desktop testing
- 📲 **Installable PWA** — standalone app with offline-first service worker; airplane-mode ready
- 📡 **Zero network calls** — the frontend is fully self-contained once loaded

## Quickstart

Prerequisites: [Bun](https://bun.sh) (dev server only).

```bash
git clone https://github.com/Sparky4567/electro-temerin.git
cd electro-temerin
bun install
bun run dev
# → http://localhost:3000
```

### Playing it

1. Press **▶ start audio** (browsers require a user gesture for audio).
2. Press **🧲 enable magnetometer**, then **◎ calibrate** while holding the phone still, away from magnets and metal.
3. Hold **“hold to sound”** (or tick **drone**) and move a fridge magnet toward / away from the phone.
4. No sensor? Drag on the **touch pad**, hover + two-finger scroll over it (Chromebook trackpads: vertical = pitch, horizontal / Shift+scroll = volume), press **simulate**, or use ↑/↓ + space.

## Browser support

| Environment | Magnetometer | Fallback |
|---|---|---|
| Chrome / Edge on Android (`https` or `localhost`) | ✅ `new Magnetometer()` | touch pad |
| iOS Safari, Firefox, desktop browsers | ❌ no Generic Sensor API | touch pad + simulate |

A secure context (`https://` or `http://localhost`) is **required** for the sensor API.
The status pill in the header tells you exactly where you stand.

## Install as an app (PWA)

electro-temerin is an installable, offline-capable PWA:

- **Install:** open the hosted site in Chrome/Edge on Android (or desktop Chrome) →
  ⋮ menu → *Install app* / *Add to Home screen*. It launches standalone, no browser chrome.
- **Offline:** a service worker (`public/sw.js`) precaches the full app shell
  (HTML, CSS, JS, manifest, icons) on first visit with a cache-first strategy —
  the instrument keeps working with no connection. Only same-origin assets are
  cached; the app makes no third-party requests at all.
- **iOS:** Safari → Share → *Add to Home Screen* (standalone display, touch-icon included;
  note the magnetometer itself is unavailable on iOS — the touch pad is the instrument there).

## Deploy to Cloudflare Pages

The instrument is a pure static site — `public/` is the publish directory and
`index.ts` is only a local dev server.

**Dashboard:** Cloudflare → Workers & Pages → Create → Pages → Connect to Git, then:

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | *(empty — no install or build needed)* |
| Build output directory | `public` |

`bun.lock` is intentionally not committed (dev-server only): it avoids
Bun-version skew between local dev and the Pages build image breaking
the automatic dependency install.

**CLI:**

```bash
bun run deploy
# = wrangler pages deploy public --project-name electro-temerin
```

Sensor permission headers are set via `public/_headers` (the dev server sends the
equivalent header locally). `/api/health` exists only on the dev server for debugging.

## Project structure

```
electro-temerin/
├── index.ts            # Bun dev server (static public/ + /api/health)
├── public/
│   ├── index.html      # UI (+ PWA meta/manifest links)
│   ├── app.js          # sensor + audio engine (vanilla JS, no deps)
│   ├── styles.css      # neon-dark theme
│   ├── sw.js           # offline-first service worker
│   ├── manifest.webmanifest
│   ├── icons/          # 192/512 any + maskable + apple-touch + favicon
│   └── _headers        # Cloudflare Pages headers
├── LICENSE             # MIT
└── package.json
```

## Safety

Keep strong magnets away from pacemakers, credit cards, and mechanical watches.
This is a toy instrument, not a measurement tool — readings are uncalibrated.

## License

[MIT](LICENSE) © 2026 Sparky4567
