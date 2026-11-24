// vad.js — energy-based voice activity detection (VAD) + 16kHz PCM capture.
//
// Flow: mic → AudioWorklet (20ms chunks) → resample to 16kHz → 100ms
// frames, energy measured → adaptive threshold from room noise → speech
// start/end. A 0.5s pre-roll buffer is kept so the first syllable is not
// cut. When speech ends (~0.9s silence) the utterance goes to onUtterance.
// Sentence-level processing, not live translation.
//
// Silence trimming (v12 lesson): only the real speech span is passed on —
// 0.15s before speech starts to speech end. Long leading/trailing silence
// makes small ASR models hallucinate or repeat.
// Noise guard: utterances shorter than 0.4s, or with less than 0.5s of
// real speech frames, are dropped as noise.
//
// Noise calibration (v13 lesson, from the translator app): the baseline
// is measured from QUIET frames only. The old code averaged the first 1s
// unconditionally, so speaking right after tapping the mic inflated the
// baseline to ~6x the voice and the app went deaf. Quiet frames only,
// up to 3s of waiting, then fall back to the quietest frame seen.
const FRAME = 1600; // 100ms @ 16kHz
const SILENCE_FRAMES_TO_END = 9; // 0.9s of silence ends an utterance
const PRE_ROLL = 8000; // 0.5s pre-roll
const MAX_UTTERANCE_SEC = 30; // one utterance max 30s
const QUIET_ENERGY = 0.0002; // frames louder than this may hold speech: excluded
const NOISE_FRAMES_NEEDED = 10; // 10 quiet frames (1s) set the baseline
const NOISE_WAIT_MAX_FRAMES = 30; // 3s max waiting for quiet frames

export class VoiceCapture {
  constructor({ onUtterance, onLevel, onSpeechStart, onSpeechEnd, sensitivity }) {
    this.onUtterance = onUtterance;
    this.onLevel = onLevel || (() => {});
    this.onSpeechStart = onSpeechStart || (() => {});
    this.onSpeechEnd = onSpeechEnd || (() => {});
    // Sensitivity: threshold = noise baseline x sensitivity. Smaller hears
    // quieter speech. High 3 / Medium 6 / Low 10. Default Medium.
    this.sensitivity = sensitivity || 6;
    this.running = false;
  }

  // Per-run state (also used by the Node test, which feeds _onSample
  // directly without a microphone).
  _resetState() {
    this.preRoll = [];
    this.frames = [];
    this.noiseFloor = null;
    this.noiseSum = 0;
    this.noiseFrames = 0;
    this.noiseMin = Infinity;
    this.noiseWait = 0;
    this.speaking = false;
    this.silenceFrames = 0;
    this.speechFrames = 0;
    this.speechStart = 0;
    this.speechEnd = 0;
    this.utterance = [];
    this.running = true;
  }

  async start() {
    if (this.running) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    this.stream = stream;
    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule('./vad-processor.js');
    const src = this.ctx.createMediaStreamSource(stream);
    this.node = new AudioWorkletNode(this.ctx, 'vad-processor');
    src.connect(this.node);
    this.node.port.onmessage = (e) => this._onChunk(e.data.data);
    this.sampleRate = this.ctx.sampleRate;
    this.resampleStep = this.sampleRate / 16000;
    this._resetState();
  }

  stop() {
    this.running = false;
    try { this.node?.disconnect(); } catch (_) {}
    try { this.stream?.getTracks().forEach((t) => t.stop()); } catch (_) {}
    if (this.ctx) this.ctx.close().catch(() => {});
    this.node = null;
    this.ctx = null;
  }

  _onChunk(chunk) {
    if (!this.running) return;
    // 48kHz (usual) → 16kHz: box-average downsampling.
    const step = this.resampleStep;
    let acc = 0;
    let n = 0;
    let next = step;
    for (let i = 0; i < chunk.length; i++) {
      acc += chunk[i];
      n++;
      if (i + 1 >= next) {
        this._onSample(acc / n);
        acc = 0;
        n = 0;
        next += step;
      }
    }
  }

  _onSample(v) {
    this.preRoll.push(v);
    if (this.preRoll.length > PRE_ROLL) this.preRoll.shift();
    this.frames.push(v);
    if (this.frames.length < FRAME) return;
    const frame = this.frames.splice(0, FRAME);
    let energy = 0;
    for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
    energy /= frame.length;
    this.onLevel(Math.min(1, Math.sqrt(Math.max(energy, 0)) / 0.08));

    if (this.noiseFloor === null) {
      // Baseline: average QUIET frames only. Loud frames may hold speech
      // and are excluded. If 10 quiet frames do not arrive within 3s,
      // use the average of what was collected (or the quietest frame seen).
      this.noiseWait++;
      if (energy < QUIET_ENERGY) {
        this.noiseSum += energy;
        this.noiseFrames++;
      }
      this.noiseMin = Math.min(this.noiseMin, energy);
      if (this.noiseFrames >= NOISE_FRAMES_NEEDED || this.noiseWait >= NOISE_WAIT_MAX_FRAMES) {
        this.noiseFloor = this.noiseFrames > 0 ? this.noiseSum / this.noiseFrames : this.noiseMin;
      }
      return;
    }
    const threshold = Math.max(this.noiseFloor * this.sensitivity, 0.0002);
    const isSpeech = energy > threshold;
    if (!isSpeech && !this.speaking) {
      // While quiet, slowly follow the noise floor.
      this.noiseFloor = this.noiseFloor * 0.98 + energy * 0.02;
    }
    if (isSpeech && !this.speaking) {
      this.speaking = true;
      this.silenceFrames = 0;
      this.speechFrames = 0;
      this.utterance = [...this.preRoll];
      // Keep only 0.15s before speech starts, so the first syllable is kept.
      this.speechStart = Math.max(0, this.utterance.length - 2400);
      this.speechEnd = this.utterance.length;
      this.onSpeechStart();
    }
    if (this.speaking) {
      this.utterance.push(...frame);
      if (isSpeech) {
        this.silenceFrames = 0;
        this.speechFrames++;
        this.speechEnd = this.utterance.length;
      } else if (++this.silenceFrames >= SILENCE_FRAMES_TO_END) {
        this._emit();
        return;
      }
      if (this.utterance.length > MAX_UTTERANCE_SEC * 16000) this._emit();
    }
  }

  _emit() {
    // Speech ended (also when the utterance is dropped as noise — the
    // screen shows it either way).
    this.onSpeechEnd();
    // Trim leading/trailing silence; pass only the real speech span.
    const out = new Float32Array(this.utterance.slice(this.speechStart ?? 0, this.speechEnd ?? this.utterance.length));
    const speechFrames = this.speechFrames;
    this.speaking = false;
    this.silenceFrames = 0;
    this.speechFrames = 0;
    this.speechStart = 0;
    this.speechEnd = 0;
    this.utterance = [];
    // Drop noise: under 0.4s long, or under 0.5s of real speech frames.
    if (out.length > 16000 * 0.4 && speechFrames >= 5) this.onUtterance(out);
  }

  // Send button: pass the current utterance at once, without waiting
  // for silence. Returns false when there is nothing to send.
  flush() {
    if (!this.running || !this.speaking) return false;
    const hadSpeech = this.speechFrames >= 5 && this.utterance.length > 16000 * 0.4;
    this._emit();
    return hadSpeech;
  }
}
