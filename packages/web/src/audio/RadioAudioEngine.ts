function makeSaturationCurve(k: number): Float32Array<ArrayBuffer> {
  const n = 256;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const denom = k < 1e-6 ? 1 : Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1; // -1 … +1
    curve[i] = k < 1e-6 ? x : Math.tanh(k * x) / denom;
  }
  return curve;
}

export class RadioAudioEngine {
  private readonly ctx: AudioContext;

  // Outbound chain
  private readonly highpass: BiquadFilterNode;
  private readonly lowpass: BiquadFilterNode;
  private readonly compressor: DynamicsCompressorNode;
  private readonly waveShaper: WaveShaperNode;
  private readonly dest: MediaStreamAudioDestinationNode;
  private outboundSourceNode: MediaStreamAudioSourceNode | null = null;

  // Inbound chain
  private readonly staticGain: GainNode;
  private readonly noiseBuffer: AudioBuffer;
  private readonly clickBuffer: AudioBuffer;
  private readonly squelchBuffer: AudioBuffer;
  private readonly channelBuffer: AudioBuffer;
  private readonly noiseSource: AudioBufferSourceNode;
  private noiseStarted = false;
  private inboundSourceNode: MediaStreamAudioSourceNode | null = null;
  private inboundStream: MediaStream | null = null;
  /** Hidden <audio> element that forces the browser to decode the WebRTC stream. */
  private hiddenAudio: HTMLAudioElement | null = null;
  private pttActive = false;
  private intensityValue: number;

  constructor(intensity = 0.6) {
    this.ctx = new AudioContext();
    this.intensityValue = Math.max(0, Math.min(1, intensity));

    // Outbound chain nodes
    this.highpass = this.ctx.createBiquadFilter();
    this.highpass.type = 'highpass';
    this.highpass.frequency.value = 300;

    this.lowpass = this.ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 3000;

    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -24;
    this.compressor.knee.value = 10;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;

    this.waveShaper = this.ctx.createWaveShaper();
    this.waveShaper.oversample = '4x';

    this.dest = this.ctx.createMediaStreamDestination();

    // Wire outbound static chain — source plugs in at processOutbound()
    this.highpass.connect(this.lowpass);
    this.lowpass.connect(this.compressor);
    this.compressor.connect(this.waveShaper);
    this.waveShaper.connect(this.dest);

    // Inbound chain — static noise gated by peer PTT
    this.staticGain = this.ctx.createGain();
    this.staticGain.gain.value = 0;
    this.staticGain.connect(this.ctx.destination);

    // Generate sample buffers once
    this.noiseBuffer = this.makeNoiseBuffer();
    this.clickBuffer = this.makeClickBuffer();
    this.squelchBuffer = this.makeSquelchBuffer();
    this.channelBuffer = this.makeChannelBuffer();

    // Noise source wired but NOT started — resume() starts it on first user gesture
    this.noiseSource = this.ctx.createBufferSource();
    this.noiseSource.buffer = this.noiseBuffer;
    this.noiseSource.loop = true;
    this.noiseSource.connect(this.staticGain);

    this.setIntensity(intensity);
  }

  /**
   * Returns a processed MediaStream suitable for WebRTC transmission.
   * Safe to call once per session; a second call replaces the previous source.
   */
  processOutbound(stream: MediaStream): MediaStream {
    void this.ctx.resume();
    this.outboundSourceNode?.disconnect();
    this.outboundSourceNode = this.ctx.createMediaStreamSource(stream);
    this.outboundSourceNode.connect(this.highpass);
    return this.dest.stream;
  }

  /** Wire the peer's incoming MediaStream to the speaker output. */
  processInbound(stream: MediaStream): void {
    this.inboundStream = stream;

    // Attach the remote stream to a hidden <audio> element.  Chrome (and some
    // other browsers) will not activate the RTP decoder for a WebRTC
    // MediaStream unless it is attached to a media element.  Without this,
    // createMediaStreamSource() receives no audio data even though the stream
    // and its tracks exist.  The element is muted so actual playback is routed
    // exclusively through the Web Audio graph below.
    this.ensureHiddenAudio(stream);

    // Only create the Web Audio node immediately if the context is already
    // running.  If suspended, resume().then() will call rewireInbound() after
    // the context is live — a node created on a suspended context never
    // produces audio.
    if (this.ctx.state === 'running') {
      this.rewireInbound();
    }
  }

  /**
   * Create (or replace) the hidden <audio> element that keeps the browser's
   * media pipeline active for the given remote stream.
   */
  private ensureHiddenAudio(stream: MediaStream): void {
    if (this.hiddenAudio) {
      this.hiddenAudio.pause();
      this.hiddenAudio.srcObject = null;
      this.hiddenAudio.remove();
    }
    const el = document.createElement('audio');
    el.srcObject = stream;
    el.autoplay = true;
    // Volume 0 — actual audio is played through the Web Audio graph.
    el.volume = 0;
    // Avoid some browsers refusing autoplay without user gesture; the element
    // is essentially silent so .play() should succeed.
    el.play().catch(() => { /* ignore — Web Audio path is primary */ });
    this.hiddenAudio = el;
  }

  // Must only be called when ctx.state === 'running'.
  private rewireInbound(): void {
    if (!this.inboundStream) return;
    this.inboundSourceNode?.disconnect();
    this.inboundSourceNode = this.ctx.createMediaStreamSource(this.inboundStream);
    this.inboundSourceNode.connect(this.ctx.destination);
  }

  /**
   * Call on the first user gesture (Space press via usePTT).
   * Resumes the AudioContext and starts the static noise loop.
   * Safe to call multiple times — starts the noise source only once.
   */
  resume(): void {
    void this.ctx.resume().then(() => {
      if (!this.noiseStarted) {
        this.noiseSource.start();
        this.noiseStarted = true;
      }
      // Re-wire after the context is actually running so the new
      // MediaStreamAudioSourceNode is created on an active context.
      if (this.inboundStream) this.rewireInbound();
    });
  }

  /**
   * Called when a peer_ptt event arrives from the other side.
   * active=true → click + static on; active=false → click + squelch + static off.
   */
  setPttActive(active: boolean): void {
    void this.ctx.resume();
    const now = this.ctx.currentTime;
    const ramp = 0.02; // 20ms linear ramp avoids abrupt gain steps

    this.pttActive = active;

    if (active) {
      this.staticGain.gain.linearRampToValueAtTime(this.intensityValue * 0.15, now + ramp);
      this.playBuffer(this.clickBuffer, now);
    } else {
      this.staticGain.gain.linearRampToValueAtTime(0, now + ramp);
      this.playBuffer(this.clickBuffer, now);
      // Squelch tail follows immediately after click completes
      this.playBuffer(this.squelchBuffer, now + this.clickBuffer.duration);
    }
  }

  /** Called when a step_changed event arrives. Plays a channel-change tone. */
  onStepChanged(): void {
    void this.ctx.resume();
    this.playBuffer(this.channelBuffer, this.ctx.currentTime);
  }

  /** intensity in [0, 1]. Scales outbound compression/saturation and inbound static level. */
  setIntensity(v: number): void {
    const clamped = Math.max(0, Math.min(1, v));
    this.intensityValue = clamped;
    this.compressor.ratio.setValueAtTime(1 + 3 * clamped, this.ctx.currentTime);
    this.waveShaper.curve = makeSaturationCurve(5 * clamped);
    if (this.pttActive) {
      this.staticGain.gain.setValueAtTime(clamped * 0.15, this.ctx.currentTime);
    }
  }

  get contextState(): AudioContextState {
    return this.ctx.state;
  }

  close(): void {
    this.outboundSourceNode?.disconnect();
    this.inboundSourceNode?.disconnect();
    if (this.hiddenAudio) {
      this.hiddenAudio.pause();
      this.hiddenAudio.srcObject = null;
      this.hiddenAudio.remove();
      this.hiddenAudio = null;
    }
    void this.ctx.close();
  }

  private playBuffer(buffer: AudioBuffer, when: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ctx.destination);
    src.start(when);
  }

  // 2-second mono white noise loop
  private makeNoiseBuffer(): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, sr * 2, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  // 15ms triangular-envelope noise — PTT switch transient
  private makeClickBuffer(): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const len = Math.round(sr * 0.015);
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    const peak = Math.round(len * (5 / 15)); // attack ends at 5ms
    for (let i = 0; i < len; i++) {
      const env = i < peak ? i / peak : 1 - (i - peak) / (len - peak);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    return buf;
  }

  // 200ms exponentially-decaying noise — squelch gate closing
  private makeSquelchBuffer(): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const len = Math.round(sr * 0.2);
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / len; // 0→1
      const env = Math.pow(0.02, t); // 1.0 at start → 0.02 at end
      data[i] = (Math.random() * 2 - 1) * env;
    }
    return buf;
  }

  // 350ms frequency-sweep tone (900→1400 Hz) — radio channel change
  private makeChannelBuffer(): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const len = Math.round(sr * 0.35);
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    const fadeIn = Math.round(sr * 0.02);
    const fadeOut = Math.round(sr * 0.03);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const freq = 900 + 500 * t; // 900→1400 Hz
      phase += (2 * Math.PI * freq) / sr;
      let amp = 0.5;
      if (i < fadeIn) amp *= i / fadeIn;
      else if (i >= len - fadeOut) amp *= (len - i) / fadeOut;
      data[i] = Math.sin(phase) * amp;
    }
    return buf;
  }
}
