/**
 * AudioWorklet processor source — injected as a Blob URL.
 *
 * Captures raw PCM from the microphone at 16kHz and posts
 * Int16Array chunks back to the main thread.
 */
export const AUDIO_WORKLET_PROCESSOR_SRC = /* javascript */ `
class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferSize = 2048; // ~128ms at 16kHz
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0]; // Float32Array at native sample rate
    for (let i = 0; i < samples.length; i++) {
      // Convert Float32 [-1, 1] → Int16 [-32768, 32767]
      const s = Math.max(-1, Math.min(1, samples[i]));
      this._buffer.push(s < 0 ? s * 0x8000 : s * 0x7fff);
    }

    if (this._buffer.length >= this._bufferSize) {
      const chunk = new Int16Array(this._buffer.splice(0, this._bufferSize));
      this.port.postMessage({ type: "pcm", chunk }, [chunk.buffer]);
    }

    return true;
  }
}

registerProcessor("pcm-capture-processor", PCMCaptureProcessor);
`;

/**
 * Playback processor — receives Int16 PCM from server and
 * outputs Float32 to the audio hardware.
 */
export const AUDIO_PLAYBACK_PROCESSOR_SRC = /* javascript */ `
class PCMPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._queue = [];
    this.port.onmessage = (e) => {
      if (e.data.type === "pcm") {
        this._queue.push(e.data.chunk); // Int16Array
      } else if (e.data.type === "flush") {
        this._queue = [];
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0][0];
    if (!output) return true;

    let offset = 0;
    while (offset < output.length && this._queue.length > 0) {
      const chunk = this._queue[0];
      const remaining = output.length - offset;
      const toCopy = Math.min(chunk.length, remaining);

      for (let i = 0; i < toCopy; i++) {
        output[offset + i] = chunk[i] / (chunk[i] < 0 ? 0x8000 : 0x7fff);
      }

      offset += toCopy;
      if (toCopy === chunk.length) {
        this._queue.shift();
      } else {
        this._queue[0] = chunk.subarray(toCopy);
      }
    }

    return true;
  }
}

registerProcessor("pcm-playback-processor", PCMPlaybackProcessor);
`;

export function createBlobUrl(src: string): string {
  const blob = new Blob([src], { type: "application/javascript" });
  return URL.createObjectURL(blob);
}
