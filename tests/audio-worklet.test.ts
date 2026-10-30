import { describe, it, expect } from "vitest";
import {
  installAudioWorklet,
  AUDIO_PROCESSOR_NAME,
} from "../src/audio-worklet.js";
import { renderPerformance } from "../src/audio-dsp.js";
import type { SynthesisInput } from "../src/audio-dsp.js";

const input: SynthesisInput = {
  strings: ["s"],
  durationSeconds: 0.2,
  events: [
    {
      id: "a",
      stringId: "s",
      frequency: 440,
      onsetSeconds: 0,
      endSeconds: 0.15,
      excitationSeed: 123,
      velocity: 0.7,
      brightness: 0.6,
      pluckPosition: 0.2,
      decaySeconds: 1,
      muted: false,
    },
  ],
};
function fixture() {
  const messages: any[] = [];
  let closed = false;
  class Base {
    port = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage: (m: unknown) => messages.push(m),
      close: () => {
        closed = true;
      },
    };
  }
  let Constructor: any;
  const host = {
    sampleRate: 48000,
    currentFrame: 0,
    AudioWorkletProcessor: Base,
    registerProcessor: (name: string, ctor: any) => {
      expect(name).toBe(AUDIO_PROCESSOR_NAME);
      Constructor = ctor;
    },
  };
  installAudioWorklet(host);
  const processor = new Constructor();
  return {
    host,
    messages,
    get closed() {
      return closed;
    },
    send: (data: unknown) => processor.port.onmessage({ data }),
    block: (size = 128) => {
      const l = new Float32Array(size),
        r = new Float32Array(size),
        alive = processor.process([], [[l, r]]);
      host.currentFrame += size;
      return { l, r, alive };
    },
  };
}
describe("AudioWorklet protocol and sample scheduling", () => {
  it("is silent until prepared input receives a start, including a mid-quantum start", () => {
    const f = fixture();
    f.send({ type: "load", id: 1, input });
    expect(f.messages).toContainEqual({ type: "ready", id: 1 });
    expect(f.block().l.every((v) => v === 0)).toBe(true);
    f.send({ type: "start", id: 1, when: 200 / 48000 });
    const { l } = f.block();
    expect(l.slice(0, 72).every((v) => v === 0)).toBe(true);
    expect(l.slice(72).some((v) => v !== 0)).toBe(true);
    expect(f.messages).toContainEqual({
      type: "started",
      id: 1,
      when: 200 / 48000,
    });
  });
  it("matches the offline DSP bit-for-bit over arbitrary quantum sizes", () => {
    const f = fixture();
    f.send({ type: "load", id: 1, input, tailSeconds: 0 });
    f.send({ type: "start", id: 1, when: 0 });
    const expected = renderPerformance(input, { tailSeconds: 0 }),
      actual = new Float32Array(expected.channels[0].length);
    let at = 0;
    while (at < actual.length) {
      const block = f.block(Math.min(257, actual.length - at));
      actual.set(block.l, at);
      at += block.l.length;
    }
    expect(actual.every((v, i) => v === expected.channels[0][i])).toBe(true);
    expect(f.messages.filter((m) => m.type === "ended")).toHaveLength(1);
    expect(f.messages.at(-1).reason).toBe("ended");
    expect(f.block().l.every((v) => v === 0)).toBe(true);
  });
  it("stops with a short fade and suppresses every future pluck", () => {
    const f = fixture();
    f.send({
      type: "load",
      id: 1,
      input: {
        ...input,
        events: [
          ...input.events,
          { ...input.events[0], id: "b", onsetSeconds: 0.16, endSeconds: 0.19 },
        ],
      },
    });
    f.send({ type: "start", id: 1, when: 0 });
    f.block();
    f.send({ type: "stop" });
    f.block(480);
    const ended = f.messages.find((m) => m.type === "ended");
    expect(ended.reason).toBe("stopped");
    expect(ended.stats.excitations).toBe(1);
    expect(f.block().l.every((v) => v === 0)).toBe(true);
  });
  it("replaces an active request only at the prepared replacement deadline", () => {
    const f = fixture();
    f.send({ type: "load", id: 1, input });
    f.send({ type: "start", id: 1, when: 0 });
    f.block();
    f.send({ type: "load", id: 2, input });
    expect(f.block().l.some((v) => v !== 0)).toBe(true);
    f.send({ type: "start", id: 2, when: 300 / 48000 });
    f.block();
    expect(
      f.messages.filter((m) => m.type === "started").map((m) => m.id),
    ).toEqual([1, 2]);
    expect(
      f.messages.find((m) => m.type === "ended" && m.id === 1).reason,
    ).toBe("stopped");
  });
  it("cancels pending starts and ignores stale start messages", () => {
    const f = fixture();
    f.send({ type: "load", id: 1, input });
    f.send({ type: "stop" });
    f.send({ type: "start", id: 1, when: 0 });
    expect(f.block().l.every((v) => v === 0)).toBe(true);
    expect(f.messages.some((m) => m.type === "started")).toBe(false);
    expect(f.messages.at(-1).reason).toBe("stopped");
  });
  it("rejects deadlines already passed and invalid synthesis inputs", () => {
    const f = fixture();
    f.block();
    f.send({ type: "load", id: 1, input });
    f.send({ type: "start", id: 1, when: 0 });
    expect(f.messages.at(-1).type).toBe("error");
    f.send({ type: "load", id: 2, input: { ...input, strings: [] } });
    expect(f.messages.at(-1).type).toBe("error");
    expect(f.block().l.every((v) => v === 0)).toBe(true);
  });
  it("does not resurrect an ended pending job after a bad replacement", () => {
    const f = fixture();
    f.send({ type: "load", id: 1, input });
    f.send({ type: "start", id: 1, when: 0.01 });
    f.send({ type: "load", id: 2, input: { ...input, strings: [] } });
    expect(f.block(1000).l.every((v) => v === 0)).toBe(true);
    expect(f.messages.filter((m) => m.type === "ended")).toHaveLength(1);
  });
  it("disposes the processor and closes its message port", () => {
    const f = fixture();
    f.send({ type: "dispose" });
    expect(f.closed).toBe(true);
    expect(f.block().alive).toBe(false);
  });
});
