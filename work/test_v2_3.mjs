// test_v2_3.mjs — Node verification for tutor v2.3 (mic carry-over from the
// translator app v14–v16).
// Run from ~/workspace/primary-school-ai/work: node test_v2_3.mjs
//
// Covers:
//   (1) EQ profile mapping for all three noise levels (highpass + presence
//       + threshold multiplier each), with boundary values.
//   (2) label migration: old stored sensitivity value -> new noise level,
//       with IDENTICAL behaviour (old 'high', most sensitive x3, becomes
//       new 'low' noise; old 'low', least sensitive x10, becomes new
//       'high' noise; 'mid' unchanged; unknown/missing -> 'mid').
//   (3) setSensitivity wiring: updates the threshold multiplier AND the
//       filter values at once (tested with mock filter objects — the real
//       AudioContext/BiquadFilter part is browser-only).
//   (4) static checks — v2.3 version strings, noise-level labels + hint in
//       the UI, capture.setSensitivity used (not a direct assignment, which
//       would leave the EQ on the old setting), mic chain order
//       src -> highpass -> peaking -> worklet in vad.js.
//
// What Node CANNOT test (parent verifies in the browser; Won's phone is
// the only proof for mic quality): AudioContext/AudioWorklet creation,
// real mic recording, whether the EQ actually makes base-en ASR hear
// muffled speech, TTS sound.
import { VoiceCapture, eqProfileForSensitivity, legacySensitivityToNoiseLevel } from '../vad.js';
import fs from 'node:fs';

let pass = 0, fail = 0;
function t(name, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}
function eqEq(a, b) { return a.hp === b.hp && a.peakGain === b.peakGain; }

// ---- (1) EQ profile: the two knobs move in OPPOSITE directions ----
// Low noise (quiet place): most sensitive, low-cut 80Hz, presence +6dB.
// Medium: 120Hz, +3dB. High noise: least sensitive, low-cut 200Hz,
// presence +0dB (boosting presence in noise amplifies the noise too).
// The input is the threshold multiplier: 3 / 6 / 10.
t('eq: mult 3 -> hp 80, +6dB', eqEq(eqProfileForSensitivity(3), { hp: 80, peakGain: 6 }));
t('eq: mult 6 -> hp 120, +3dB', eqEq(eqProfileForSensitivity(6), { hp: 120, peakGain: 3 }));
t('eq: mult 10 -> hp 200, +0dB', eqEq(eqProfileForSensitivity(10), { hp: 200, peakGain: 0 }));
t('eq: mult 1 -> quiet profile', eqEq(eqProfileForSensitivity(1), { hp: 80, peakGain: 6 }));
t('eq: mult 2 -> quiet profile', eqEq(eqProfileForSensitivity(2), { hp: 80, peakGain: 6 }));
t('eq: mult 9 -> medium profile', eqEq(eqProfileForSensitivity(9), { hp: 120, peakGain: 3 }));
t('eq: mult 11 -> noisy profile', eqEq(eqProfileForSensitivity(11), { hp: 200, peakGain: 0 }));
t('eq: mult 0 -> quiet profile', eqEq(eqProfileForSensitivity(0), { hp: 80, peakGain: 6 }));

// ---- (2) migration: old sensitivity label -> new noise label ----
// Behaviour must be IDENTICAL after the rename. The multiplier map in
// app.js (noise level -> threshold multiplier) is { low: 3, mid: 6,
// high: 10 }; this checks the whole chain legacy -> noise -> mult -> EQ.
const MULT = { low: 3, mid: 6, high: 10 };
function migratedEq(legacy) {
  const noise = legacySensitivityToNoiseLevel(legacy);
  return { noise, mult: MULT[noise], eq: eqProfileForSensitivity(MULT[noise]) };
}
const mHigh = migratedEq('high');
t("migrate: old 'high' (most sensitive x3) -> noise 'low'", mHigh.noise === 'low' && mHigh.mult === 3);
t("migrate: old 'high' keeps hp 80 / +6dB", eqEq(mHigh.eq, { hp: 80, peakGain: 6 }));
const mMid = migratedEq('mid');
t("migrate: old 'mid' -> noise 'mid', x6", mMid.noise === 'mid' && mMid.mult === 6);
t("migrate: old 'mid' keeps hp 120 / +3dB", eqEq(mMid.eq, { hp: 120, peakGain: 3 }));
const mLow = migratedEq('low');
t("migrate: old 'low' (least sensitive x10) -> noise 'high'", mLow.noise === 'high' && mLow.mult === 10);
t("migrate: old 'low' keeps hp 200 / +0dB", eqEq(mLow.eq, { hp: 200, peakGain: 0 }));
t('migrate: missing -> mid', legacySensitivityToNoiseLevel(undefined) === 'mid');
t('migrate: null -> mid', legacySensitivityToNoiseLevel(null) === 'mid');
t("migrate: '' -> mid", legacySensitivityToNoiseLevel('') === 'mid');
t("migrate: junk -> mid", legacySensitivityToNoiseLevel('loud') === 'mid');
// NOTE: the helper is one-way by design — feeding it an already-migrated
// value would flip it back. That is why app.js only calls it when the
// 'psa-sensitivity-noise' flag is absent (see the static check below).

// ---- (3) setSensitivity: threshold + EQ change together ----
// Mock filter objects stand in for BiquadFilter (browser-only).
const vc = new VoiceCapture({ sensitivity: 6, onUtterance: () => {} });
vc.hpFilter = { frequency: { value: 0 } };
vc.peakFilter = { gain: { value: 0 } };
vc.setSensitivity(3);
t('setSens: mult 3 sets threshold 3', vc.sensitivity === 3);
t('setSens: mult 3 sets hp 80', vc.hpFilter.frequency.value === 80);
t('setSens: mult 3 sets peak +6', vc.peakFilter.gain.value === 6);
vc.setSensitivity(10);
t('setSens: mult 10 sets threshold 10', vc.sensitivity === 10);
t('setSens: mult 10 sets hp 200', vc.hpFilter.frequency.value === 200);
t('setSens: mult 10 sets peak +0', vc.peakFilter.gain.value === 0);
vc.setSensitivity(6);
t('setSens: mult 6 sets threshold 6', vc.sensitivity === 6);
t('setSens: mult 6 sets hp 120', vc.hpFilter.frequency.value === 120);
t('setSens: mult 6 sets peak +3', vc.peakFilter.gain.value === 3);
const vcNoFilters = new VoiceCapture({ sensitivity: 6, onUtterance: () => {} });
let threw = false;
try { vcNoFilters.setSensitivity(3); } catch (_) { threw = true; }
t('setSens: no filters yet (not listening) does not throw', !threw && vcNoFilters.sensitivity === 3);

// ---- (4) static checks: version, labels, wiring ----
// Note: vad.js is read as ../vad.js here, app.js/index.html/sw.js as ../.
const appJs = fs.readFileSync('../app.js', 'utf8');
const vadJs = fs.readFileSync('../vad.js', 'utf8');
const swJs = fs.readFileSync('../sw.js', 'utf8');
const html = fs.readFileSync('../index.html', 'utf8');
t('static: APP_VERSION v2.6.1', appJs.includes("const APP_VERSION = 'v2.6.1'"));
t('static: SW cache primary-school-ai-v2.6.1', swJs.includes("const CACHE = 'primary-school-ai-v2.6.1'"));
t('static: no stale v2.2.1 version strings', !appJs.includes('v2.2.1') && !swJs.includes('v2.2.1'));
t('static: noise multiplier map { low: 3, mid: 6, high: 10 }',
  appJs.includes('const SENSITIVITY = { low: 3, mid: 6, high: 10 };'));
t('static: migration helper imported', appJs.includes("legacySensitivityToNoiseLevel } from './vad.js'"));
t('static: migration flag psa-sensitivity-noise used', appJs.includes("'psa-sensitivity-noise'"));
t('static: live change calls capture.setSensitivity(', appJs.includes('capture.setSensitivity(SENSITIVITY[next])'));
t('static: no direct capture.sensitivity assignment left', !appJs.includes('capture.sensitivity ='));
t('static: UI label is Noise', html.includes('aria-label="Noise level"') && html.includes('<span>Noise</span>'));
t('static: UI hint "Quiet place: Low. Noisy place: High."', html.includes('Quiet place: Low. Noisy place: High.'));
t('static: old sensitivity hint gone', !html.includes('If it does not hear you'));
t('static: mic chain src -> highpass -> peaking -> worklet',
  vadJs.includes('src.connect(this.hpFilter)') &&
  vadJs.includes('this.hpFilter.connect(this.peakFilter)') &&
  vadJs.includes('this.peakFilter.connect(this.node)'));
t('static: peaking filter at 2.5kHz, Q 1', vadJs.includes('this.peakFilter.frequency.value = 2500') && vadJs.includes('this.peakFilter.Q.value = 1'));
t('static: highpass type set', vadJs.includes("this.hpFilter.type = 'highpass'"));
t('static: stop() disconnects the filters',
  vadJs.includes('this.hpFilter?.disconnect()') && vadJs.includes('this.peakFilter?.disconnect()'));
t('static: Ask bands untouched (0.40 / 0.67)', appJs.includes('0.40') && appJs.includes('0.67'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
