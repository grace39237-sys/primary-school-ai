// vad-processor.js — AudioWorklet: sends mic input to the main thread
// in 20ms chunks. Copied from the translator app (unchanged).
class VadProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = [];
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const ch = input[0];
      for (let i = 0; i < ch.length; i++) this.buf.push(ch[i]);
      if (this.buf.length >= 960) {
        this.port.postMessage({ type: 'chunk', data: new Float32Array(this.buf) });
        this.buf = [];
      }
    }
    return true;
  }
}
registerProcessor('vad-processor', VadProcessor);
