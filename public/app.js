/* electro-temerin — magnetometer theremin
 * Pitch <= magnetic-field delta (Generic Sensor API Magnetometer),
 * Volume/gate <= touch pad + slider. Touch pad is a full fallback instrument.
 */
"use strict";

const $ = (id) => document.getElementById(id);
const els = {
  orb: $("orb"), powerBtn: $("powerBtn"), ctxPill: $("ctxPill"),
  noteName: $("noteName"), freqVal: $("freqVal"), midiVal: $("midiVal"),
  barX: $("barX"), barY: $("barY"), barZ: $("barZ"), barM: $("barM"),
  valX: $("valX"), valY: $("valY"), valZ: $("valZ"), valM: $("valM"),
  baseVal: $("baseVal"), deltaVal: $("deltaVal"),
  sensorStatus: $("sensorStatus"), sensorBtn: $("sensorBtn"), calBtn: $("calBtn"), simBtn: $("simBtn"),
  pitchSource: $("pitchSource"), polarity: $("polarity"),
  range: $("range"), rangeVal: $("rangeVal"), smooth: $("smooth"), smoothVal: $("smoothVal"),
  wave: $("wave"), scale: $("scale"), root: $("root"), rootVal: $("rootVal"),
  octaves: $("octaves"), octVal: $("octVal"), glide: $("glide"), glideVal: $("glideVal"),
  vib: $("vib"), vibVal: $("vibVal"), cutoff: $("cutoff"), cutVal: $("cutVal"),
  echo: $("echo"), echoVal: $("echoVal"), vol: $("vol"), volVal: $("volVal"),
  gateBtn: $("gateBtn"), drone: $("drone"),
  modeMag: $("modeMag"), modeTouch: $("modeTouch"),
  pad: $("pad"), padDot: $("padDot"), scope: $("scope"),
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SCALES = {
  off: null,
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentaM: [0, 2, 4, 7, 9],
  pentaMin: [0, 3, 5, 7, 10],
};

const state = {
  audioOn: false,
  mode: "mag",            // 'mag' | 'touch'
  sensorLive: false,
  simulating: false,
  baseline: null,         // {x,y,z,mag}
  smoothMag: 0, smoothX: 0, smoothY: 0, smoothZ: 0,
  calSamples: [],
  calibrating: false,
  padActive: false,
  padPitch01: 0.5, padVol01: 0.7,
  gateHeld: false,
  lastMidi: -1,
};

// ---------- secure-context pill ----------
(function securePill() {
  const secure = window.isSecureContext;
  const mag = ("Magnetometer" in window);
  if (!secure) {
    els.ctxPill.textContent = "⚠ insecure context — sensor blocked (use https/localhost)";
    els.ctxPill.className = "pill bad";
  } else if (!mag) {
    els.ctxPill.textContent = "no Magnetometer API — touch pad ready";
    els.ctxPill.className = "pill warn";
  } else {
    els.ctxPill.textContent = "secure ✓ · Magnetometer available";
    els.ctxPill.className = "pill ok";
  }
})();

// ---------- audio engine ----------
const Audio2 = {
  ctx: null, osc: null, vibOsc: null, vibGain: null,
  filter: null, voiceGain: null, master: null,
  delay: null, fb: null, wet: null, analyser: null,

  async start() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: "interactive" });
    const c = this.ctx;

    this.osc = c.createOscillator();
    this.osc.type = els.wave.value;
    this.osc.frequency.value = 220;

    this.vibOsc = c.createOscillator();
    this.vibOsc.frequency.value = 5.5;
    this.vibGain = c.createGain();
    this.vibGain.gain.value = 0;
    this.vibOsc.connect(this.vibGain).connect(this.osc.frequency);

    this.filter = c.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = Number(els.cutoff.value);
    this.filter.Q.value = 0.8;

    this.voiceGain = c.createGain();
    this.voiceGain.gain.value = 0;

    this.master = c.createGain();
    this.master.gain.value = Number(els.vol.value);

    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 2048;

    // simple echo
    this.delay = c.createDelay(1);
    this.delay.delayTime.value = 0.27;
    this.fb = c.createGain(); this.fb.gain.value = 0.32;
    this.wet = c.createGain(); this.wet.gain.value = Number(els.echo.value);
    this.voiceGain.connect(this.filter);
    this.filter.connect(this.master);
    this.filter.connect(this.delay);
    this.delay.connect(this.fb).connect(this.delay);
    this.delay.connect(this.wet).connect(this.master);
    this.master.connect(this.analyser).connect(c.destination);

    this.osc.start();
    this.vibOsc.start();
  },

  setTargetFreq(freq) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const glide = Number(els.glide.value);
    this.osc.frequency.setTargetAtTime(Math.max(20, Math.min(4000, freq)), t, glide);
  },

  setGate(open) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.voiceGain.gain.setTargetAtTime(open ? 1 : 0, t, open ? 0.015 : 0.06);
  },
};

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function midiToName(m) {
  const r = Math.round(m);
  return NOTE_NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1);
}
function quantize(midiFloat, scaleKey) {
  const iv = SCALES[scaleKey];
  if (!iv) return midiFloat;
  const lo = Math.floor(midiFloat), hi = Math.ceil(midiFloat);
  // search nearest midi that belongs to scale (any octave), prefer closer
  for (let d = 0; d <= 12; d++) {
    for (const c of [Math.round(midiFloat) + d, Math.round(midiFloat) - d]) {
      if (iv.includes(((c % 12) + 12) % 12)) return c;
    }
    void lo; void hi;
  }
  return Math.round(midiFloat);
}

// Map normalized 0..1 pitch position -> midi -> freq, honoring root/octaves/scale
function pitch01ToFreq(p01) {
  const root = Number(els.root.value);
  const octs = Number(els.octaves.value);
  const raw = root + Math.min(1, Math.max(0, p01)) * octs * 12;
  const q = quantize(raw, els.scale.value);
  return { freq: midiToFreq(q), midi: q, raw };
}

// Magnetometer delta-uT -> 0..1 pitch position
function fieldToPitch01() {
  const range = Number(els.range.value);
  const pol = Number(els.polarity.value);
  const b = state.baseline;
  let d;
  if (!b) {
    d = Math.max(0, state.smoothMag - 45); // uncalibrated guess: earth ~45uT
  } else {
    const src = els.pitchSource.value;
    if (src === "mag") d = state.smoothMag - b.mag;
    else if (src === "x") d = state.smoothX - b.x;
    else if (src === "y") d = state.smoothY - b.y;
    else d = state.smoothZ - b.z;
    d = d * pol;
    d = Math.max(0, d); // clamp: moving the "wrong way" past baseline = bottom of range
  }
  return Math.min(1, Math.max(0, d / range));
}

// ---------- main per-frame update ----------
let currentFreq = 220, currentMidi = 57;
function tick() {
  // pick pitch position
  let p01;
  if (state.mode === "touch" || state.padActive) {
    p01 = 1 - state.padPitch01; // pad top = high
  } else {
    p01 = fieldToPitch01();
    if (state.simulating) {
      const t = performance.now() / 1000;
      p01 = 0.5 + 0.42 * Math.sin(t * 1.4) * Math.sin(t * 0.37 + 1);
    }
  }
  const { freq, midi } = pitch01ToFreq(p01);
  currentFreq = freq; currentMidi = midi;

  if (state.audioOn && Audio2.ctx) {
    Audio2.setTargetFreq(freq);
    const gate = els.drone.checked || state.gateHeld || state.padActive || state.simulating;
    Audio2.setGate(gate);
    // touch-mode volume from pad X
    if (state.padActive) Audio2.master.gain.setTargetAtTime(0.05 + state.padVol01 * 0.95, Audio2.ctx.currentTime, 0.03);
    else Audio2.master.gain.setTargetAtTime(Number(els.vol.value), Audio2.ctx.currentTime, 0.03);
  }

  // readouts
  els.freqVal.textContent = freq.toFixed(1);
  els.midiVal.textContent = "midi " + midi.toFixed(1);
  els.noteName.textContent = midiToName(midi);

  // field bars (normalize ±150uT per axis, 0..250 for |B|)
  const bx = Math.min(1, Math.abs(state.smoothX) / 150), by = Math.min(1, Math.abs(state.smoothY) / 150),
        bz = Math.min(1, Math.abs(state.smoothZ) / 150), bm = Math.min(1, state.smoothMag / 250);
  els.barX.style.width = (bx * 100) + "%"; els.barY.style.width = (by * 100) + "%";
  els.barZ.style.width = (bz * 100) + "%"; els.barM.style.width = (bm * 100) + "%";
  els.valX.textContent = state.smoothX.toFixed(1); els.valY.textContent = state.smoothY.toFixed(1);
  els.valZ.textContent = state.smoothZ.toFixed(1); els.valM.textContent = state.smoothMag.toFixed(1) + " µT";
  if (state.baseline) {
    els.baseVal.textContent = state.baseline.mag.toFixed(1) + " µT";
    const src = els.pitchSource.value;
    const d = src === "mag" ? state.smoothMag - state.baseline.mag
      : src === "x" ? state.smoothX - state.baseline.x
      : src === "y" ? state.smoothY - state.baseline.y : state.smoothZ - state.baseline.z;
    els.deltaVal.textContent = (d >= 0 ? "+" : "") + d.toFixed(1) + " µT";
  }

  // orb glow tracks pitch
  const glow = state.audioOn ? 0.4 + p01 * 0.6 : 0.25;
  els.orb.style.transform = `scale(${0.9 + p01 * 0.35})`;
  els.orb.style.boxShadow = `0 0 ${18 + p01 * 40}px #41f2c3${Math.round(glow * 255).toString(16).padStart(2, "0")}`;

  drawScope();
  requestAnimationFrame(tick);
}

// ---------- scope ----------
const sctx = els.scope.getContext("2d");
const timeData = new Uint8Array(2048);
function drawScope() {
  const W = els.scope.width, H = els.scope.height;
  sctx.clearRect(0, 0, W, H);
  sctx.fillStyle = "#05070c"; sctx.fillRect(0, 0, W, H);
  // grid: pitch position line
  let p01 = state.mode === "touch" || state.padActive ? 1 - state.padPitch01 : fieldToPitch01();
  sctx.strokeStyle = "#232c44"; sctx.lineWidth = 1;
  sctx.beginPath(); sctx.moveTo(0, H - p01 * H); sctx.lineTo(W, H - p01 * H); sctx.stroke();
  if (Audio2.analyser && state.audioOn) {
    Audio2.analyser.getByteTimeDomainData(timeData);
    sctx.strokeStyle = "#41f2c3"; sctx.lineWidth = 2; sctx.beginPath();
    const step = Math.floor(timeData.length / W);
    for (let x = 0; x < W; x++) {
      const v = timeData[x * step] / 128 - 1;
      const y = H / 2 + v * H * 0.45;
      x === 0 ? sctx.moveTo(x, y) : sctx.lineTo(x, y);
    }
    sctx.stroke();
  } else {
    sctx.fillStyle = "#3a4566"; sctx.font = "13px system-ui";
    sctx.fillText(state.audioOn ? "waveform appears when sounding…" : "press ⟶ start audio, then enable magnetometer or drag the pad", 14, H / 2);
  }
}

// ---------- magnetometer ----------
function setSensorMsg(msg, cls = "") {
  els.sensorStatus.textContent = msg;
  els.sensorStatus.className = "sensor-status " + cls;
}

function applyReading(x, y, z) {
  const a = Number(els.smooth.value); // 0.01..0.9 ; higher = smoother? use as lerp weight inverse
  const k = 1 - Math.min(0.95, Math.max(0.01, a)); // new-sample weight
  state.smoothX += (x - state.smoothX) * k;
  state.smoothY += (y - state.smoothY) * k;
  state.smoothZ += (z - state.smoothZ) * k;
  state.smoothMag = Math.sqrt(state.smoothX ** 2 + state.smoothY ** 2 + state.smoothZ ** 2);

  if (state.calibrating) {
    state.calSamples.push({ x, y, z, mag: Math.sqrt(x * x + y * y + z * z) });
    setSensorMsg(`calibrating… hold still (${state.calSamples.length}/40)`);
    if (state.calSamples.length >= 40) {
      const n = state.calSamples.length;
      const avg = (f) => state.calSamples.reduce((s, s2) => s + f(s2), 0) / n;
      state.baseline = { x: avg((s) => s.x), y: avg((s) => s.y), z: avg((s) => s.z), mag: avg((s) => s.mag) };
      state.calibrating = false; state.calSamples = [];
      setSensorMsg(`calibrated ✓ baseline |B|=${state.baseline.mag.toFixed(1)} µT — bring a magnet near to play`, "live");
    }
  }
}

async function enableMagnetometer() {
  if (!window.isSecureContext) {
    setSensorMsg("Blocked: Magnetometer needs a secure context (https:// or http://localhost). Touch pad still works.", "err");
    return;
  }
  if (!("Magnetometer" in window)) {
    setSensorMsg("No Magnetometer API in this browser (needs Chrome/Edge on Android). Use touch pad or Simulate.", "err");
    return;
  }
  try {
    // Optional permission query — not all browsers support 'magnetometer' name.
    try {
      const p = await navigator.permissions?.query({ name: "magnetometer" });
      if (p && p.state === "denied") {
        setSensorMsg("Magnetometer permission denied in browser settings.", "err");
        return;
      }
    } catch { /* ignore — permission name unsupported in some builds */ }
    const Mag = window.Magnetometer;
    const sensor = new Mag({ frequency: 30 });
    sensor.addEventListener("reading", () => applyReading(sensor.x, sensor.y, sensor.z));
    sensor.addEventListener("error", (e) => {
      setSensorMsg("Sensor error: " + (e.error?.name || "unknown") + " — " + (e.error?.message || "cannot read field"), "err");
    });
    sensor.start();
    state.sensorLive = true; state.simulating = false;
    els.calBtn.disabled = false;
    els.sensorBtn.textContent = "🧲 sensor live ✓ (tap to restart)";
    setSensorMsg("Live ✓ — now press ◎ calibrate away from magnets/metal, then play.", "live");
  } catch (err) {
    setSensorMsg(`Cannot start sensor (${err?.name || "Error"}): ${err?.message || err}. Try Serve over https, or use Simulate.`, "err");
  }
}

// ---------- UI wiring ----------
els.sensorBtn.addEventListener("click", enableMagnetometer);
els.calBtn.addEventListener("click", () => {
  if (!state.sensorLive && !state.simulating) {
    // allow calibration of the simulator baseline too
    state.simulating = true;
    setSensorMsg("simulate mode: calibrating virtual baseline…", "");
  }
  state.calSamples = []; state.calibrating = true;
  if (state.simulating && !state.sensorLive) {
    // synthesize 40 still-air samples around 48µT
    let i = 0;
    const iv = setInterval(() => {
      applyReading(12 + Math.random(), -8 + Math.random(), 44 + Math.random(), 0);
      if (++i >= 40 || !state.calibrating) clearInterval(iv);
    }, 25);
  }
});
els.simBtn.addEventListener("click", () => {
  state.simulating = !state.simulating;
  els.simBtn.textContent = state.simulating ? "stop simulation" : "simulate";
  if (state.simulating) {
    els.calBtn.disabled = false;
    // virtual baseline + animated field in tick loop
    if (!state.baseline) state.baseline = { x: 12, y: -8, z: 44, mag: 48 };
    const iv = setInterval(() => {
      if (!state.simulating) return clearInterval(iv);
      if (!state.sensorLive) {
        const t = performance.now() / 1000;
        const lift = 20 + 90 * (0.5 + 0.5 * Math.sin(t * 1.4));
        applyReading(12 + lift * 0.2, -8 + lift * 0.1, 44 + lift, 0);
      }
    }, 50);
    setSensorMsg("Simulating a moving magnet — pitch sweeps automatically. Press ◎ calibrate to set baseline, or enable the real sensor.", "live");
  } else setSensorMsg(state.sensorLive ? "Sensor live." : "idle — press “enable magnetometer”", state.sensorLive ? "live" : "");
});

els.powerBtn.addEventListener("click", async () => {
  await Audio2.start();
  if (!state.audioOn) {
    if (Audio2.ctx.state === "suspended") await Audio2.ctx.resume();
    state.audioOn = true;
    els.powerBtn.textContent = "⏸ audio on — tap to suspend";
    return;
  }
  if (Audio2.ctx.state === "running") { await Audio2.ctx.suspend(); els.powerBtn.textContent = "▶ audio suspended — tap to resume"; }
  else { await Audio2.ctx.resume(); els.powerBtn.textContent = "⏸ audio on — tap to suspend"; }
});

// gate button (hold to sound in mag mode)
const gateOn = (e) => { e.preventDefault(); state.gateHeld = true; els.gateBtn.classList.add("on"); };
const gateOff = () => { state.gateHeld = false; els.gateBtn.classList.remove("on"); };
els.gateBtn.addEventListener("pointerdown", gateOn);
window.addEventListener("pointerup", gateOff);
els.gateBtn.addEventListener("pointerleave", gateOff);

// mode segmented
function setMode(m) {
  state.mode = m;
  els.modeMag.classList.toggle("active", m === "mag");
  els.modeTouch.classList.toggle("active", m === "touch");
}
els.modeMag.addEventListener("click", () => setMode("mag"));
els.modeTouch.addEventListener("click", () => setMode("touch"));

// pad: pointer => pitch (Y) + volume (X); overrides sensor while touching
function padSet(e) {
  const r = els.pad.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  state.padPitch01 = Math.min(1, Math.max(0, y));
  state.padVol01 = Math.min(1, Math.max(0, x));
  els.padDot.style.left = (x * 100) + "%";
  els.padDot.style.top = (y * 100) + "%";
}
els.pad.addEventListener("pointerdown", (e) => { e.preventDefault(); state.padActive = true; els.pad.setPointerCapture(e.pointerId); padSet(e); });
els.pad.addEventListener("pointermove", (e) => { if (state.padActive) { e.preventDefault(); padSet(e); } });
els.pad.addEventListener("pointerup", () => { state.padActive = false; });
els.pad.addEventListener("pointercancel", () => { state.padActive = false; });
// Chromebook trackpads (and mouse wheels) fire wheel, not drag —
// capture it so two-finger scroll plays instead of scrolling the page.
let wheelHold = 0;
els.pad.addEventListener("wheel", (e) => {
  e.preventDefault();
  state.padActive = true;
  state.padPitch01 = Math.min(1, Math.max(0, state.padPitch01 + e.deltaY * 0.0012));
  state.padVol01 = Math.min(1, Math.max(0, state.padVol01 - e.deltaX * 0.0012 + (e.shiftKey ? e.deltaY * 0.0012 : 0)));
  const r = els.pad.getBoundingClientRect();
  void r;
  els.padDot.style.left = (state.padVol01 * 100) + "%";
  els.padDot.style.top = (state.padPitch01 * 100) + "%";
  clearTimeout(wheelHold);
  wheelHold = setTimeout(() => { state.padActive = false; }, 900);
}, { passive: false });

// control readouts
const bind = (input, out, fmt) => {
  const f = () => { out.textContent = fmt(input.value); };
  input.addEventListener("input", f); f();
};
bind(els.range, els.rangeVal, (v) => `${v}`);
bind(els.smooth, els.smoothVal, (v) => Number(v).toFixed(2));
bind(els.root, els.rootVal, (v) => `${NOTE_NAMES[((Number(v) % 12) + 12) % 12]}${Math.floor(Number(v) / 12) - 1} · ${v}`);
bind(els.octaves, els.octVal, (v) => `${v}`);
bind(els.glide, els.glideVal, (v) => `${Number(v).toFixed(2)}s`);
bind(els.vib, els.vibVal, (v) => `${v}`);
bind(els.cutoff, els.cutVal, (v) => `${v}`);
bind(els.echo, els.echoVal, (v) => Number(v).toFixed(2));
bind(els.vol, els.volVal, (v) => Number(v).toFixed(2));
els.wave.addEventListener("change", () => { if (Audio2.osc) Audio2.osc.type = els.wave.value; });
els.cutoff.addEventListener("input", () => { if (Audio2.filter) Audio2.filter.frequency.setTargetAtTime(Number(els.cutoff.value), Audio2.ctx.currentTime, 0.03); });
els.vib.addEventListener("input", () => { if (Audio2.vibGain) Audio2.vibGain.gain.setTargetAtTime(Number(els.vib.value), Audio2.ctx.currentTime, 0.05); });
els.echo.addEventListener("input", () => { if (Audio2.wet) Audio2.wet.gain.setTargetAtTime(Number(els.echo.value), Audio2.ctx.currentTime, 0.05); });

// keyboard: arrows bend pitch when in mag mode without sensor (accessibility)
window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    state.simulating = true;
    state.smoothMag += e.key === "ArrowUp" ? 6 : -6;
    if (!state.baseline) state.baseline = { x: 0, y: 0, z: 0, mag: 45 };
  }
  if (e.key === " ") { state.gateHeld = true; els.gateBtn.classList.add("on"); e.preventDefault(); }
});
window.addEventListener("keyup", (e) => {
  if (e.key === " ") gateOff();
});

requestAnimationFrame(tick);

// PWA: offline-first service worker (same-origin app shell only).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline support unavailable — app still runs.
    });
  });
}
