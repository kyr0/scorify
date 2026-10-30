import { afterEach, describe, expect, it, vi } from "vitest";
import { createPitchInput } from "../src/tuner.js";
import { PITCH_PROCESSOR_NAME } from "../src/pitch-detect.js";

function fixture() {
  const created: Record<string, any[]> = { worklet: [], source: [], gain: [] };
  const context = {
    state: "running",
    sampleRate: 48000,
    destination: { name: "destination" },
    audioWorklet: { addModule: vi.fn(async () => {}) },
  };
  class Connectable {
    connect = vi.fn((target: unknown) => target);
    disconnect = vi.fn();
  }
  class WorkletNode extends Connectable {
    sent: unknown[] = [];
    port = { onmessage: null as ((e: { data: unknown }) => void) | null, postMessage: (m: unknown) => this.sent.push(m) };
    constructor(readonly ctx: unknown, readonly name: string, readonly options: any) {
      super();
      created.worklet!.push(this);
    }
  }
  class SourceNode extends Connectable {
    constructor(readonly ctx: unknown, readonly options: any) {
      super();
      created.source!.push(this);
    }
  }
  class Gain extends Connectable {
    constructor(readonly ctx: unknown, readonly options: any) {
      super();
      created.gain!.push(this);
    }
  }
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  const getUserMedia = vi.fn(async () => stream);
  vi.stubGlobal("AudioWorkletNode", WorkletNode);
  vi.stubGlobal("MediaStreamAudioSourceNode", SourceNode);
  vi.stubGlobal("GainNode", Gain);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  return { context: context as unknown as AudioContext, created, track, stream, getUserMedia };
}
afterEach(() => vi.unstubAllGlobals());

describe("live pitch input", () => {
  it("opens the microphone without voice processing, wires the worklet and reports readings", async () => {
    const f = fixture(),
      readings: any[] = [],
      errors: Error[] = [];
    const input = await createPitchInput(f.context, {
      minFrequency: 70,
      maxFrequency: 1000,
      onPitch: (r) => readings.push(r),
      onError: (e) => errors.push(e),
    });
    expect(f.context.audioWorklet.addModule).toHaveBeenCalledWith(expect.stringMatching(/pitch-worklet\.mjs$/));
    expect(f.getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const node = f.created.worklet![0];
    expect(node.name).toBe(PITCH_PROCESSOR_NAME);
    expect(node.options.processorOptions).toEqual({ minFrequency: 70, maxFrequency: 1000 });
    expect(f.created.source![0].options.mediaStream).toBe(f.stream);
    expect(f.created.source![0].connect).toHaveBeenCalledWith(node);
    expect(f.created.gain![0].options.gain).toBe(0);
    node.port.onmessage({ data: { type: "pitch", frequency: 110, rawFrequency: 110.2, clarity: 0.97, rms: 0.1, frame: 4800, time: 0.1, contextTime: 3.1 } });
    node.port.onmessage({ data: { type: "error", message: "bad" } });
    expect(readings).toEqual([{ frequency: 110, rawFrequency: 110.2, clarity: 0.97, rms: 0.1, frame: 4800, time: 0.1, contextTime: 3.1 }]);
    expect(errors.map((e) => e.message)).toEqual(["bad"]);
    input.configure({ minFrequency: 150 });
    expect(node.sent).toEqual([{ type: "configure", options: { minFrequency: 150 } }]);
    expect(() => input.configure({ minFrequency: -5 })).toThrow(RangeError);
    input.stop();
    input.stop();
    expect(input.stopped).toBe(true);
    expect(node.sent.at(-1)).toEqual({ type: "stop" });
    expect(f.track.stop).toHaveBeenCalledTimes(1);
    expect(f.created.source![0].disconnect).toHaveBeenCalledWith(node);
    node.port.onmessage({ data: { type: "pitch", frequency: 220 } });
    expect(readings).toHaveLength(1);
    expect(() => input.configure({})).toThrow(/stopped/);
  });
  it("uses a given stream or node without asking for the microphone, and leaves its tracks alone", async () => {
    const f = fixture(),
      own = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
    const input = await createPitchInput(f.context, { stream: own });
    expect(f.getUserMedia).not.toHaveBeenCalled();
    expect(input.stream).toBe(own);
    input.stop();
    expect((own.getTracks()[0] as any).stop).not.toHaveBeenCalled();
    const source = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode;
    const fromNode = await createPitchInput(f.context, { source });
    expect(fromNode.stream).toBeNull();
    expect(source.connect).toHaveBeenCalled();
    // The worklet module loads once per context and URL.
    expect(f.context.audioWorklet.addModule).toHaveBeenCalledTimes(1);
  });
  it("fails before asking for the microphone on invalid options, and explains a missing getUserMedia", async () => {
    const f = fixture();
    await expect(createPitchInput(f.context, { minFrequency: 5 })).rejects.toThrow(RangeError);
    expect(f.getUserMedia).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", {});
    await expect(createPitchInput(f.context)).rejects.toThrow(/secure context/);
    await expect(createPitchInput({ ...f.context, state: "closed" } as unknown as AudioContext)).rejects.toThrow(/closed/);
  });
  it("releases the microphone when wiring fails", async () => {
    const f = fixture();
    vi.stubGlobal("AudioWorkletNode", class {
      constructor() {
        throw new Error("no processor");
      }
    });
    await expect(createPitchInput(f.context)).rejects.toThrow("no processor");
    expect(f.track.stop).toHaveBeenCalled();
  });
});
