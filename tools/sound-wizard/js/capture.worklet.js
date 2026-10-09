// Sound Wizard: the audio-thread end. Collects the microphone's 128-sample render quanta into blocks
// of 1024 and hands each one straight to the analysis worker over its own MessagePort (the page's main
// thread never sees the audio). Until that port arrives, blocks go to the page (no-worker fallback).
class SoundWizardCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 1024;
    this.buf = new Float32Array(this.size);
    this.n = 0;
    this.out = this.port;
    this.port.onmessage = e => { if (e.data && e.data.port) this.out = e.data.port; };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let i = 0;
    while (i < ch.length) {
      const take = Math.min(ch.length - i, this.size - this.n);
      this.buf.set(ch.subarray(i, i + take), this.n);
      this.n += take; i += take;
      if (this.n === this.size) {
        this.out.postMessage(this.buf, [this.buf.buffer]);
        this.buf = new Float32Array(this.size);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('sound-wizard-capture', SoundWizardCapture);
