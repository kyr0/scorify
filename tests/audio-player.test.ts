import { afterEach, describe, expect, it, vi } from "vitest";
import { createAudioPlayer } from "../src/audio.js";
import { createPerformance } from "../src/performance.js";
import {
  arrange,
  createScore,
  q,
  parsePitch,
  concertUkulele,
} from "../src/index.js";

function performancePlan() {
  const instrument = concertUkulele({ fretCount: 0 });
  const r = arrange(
    createScore([
      {
        id: "a",
        pitch: parsePitch("C4"),
        onset: q(0),
        duration: q(1),
        partId: "p",
        voiceId: "v",
      },
    ]),
    { instrument },
  );
  if (r.status !== "success") throw new Error(r.status);
  const p = createPerformance(r, instrument, { humanize: 0, strum: false });
  if (p.status !== "success") throw new Error(p.status);
  return p.performance;
}
function fixture() {
  const sent: any[] = [];
  let node: any;
  const listeners = new Map<string, () => void>();
  const context = {
    state: "running",
    currentTime: 10,
    destination: {},
    audioWorklet: { addModule: vi.fn(async () => {}) },
    resume: vi.fn(async () => {}),
    addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  class Node {
    port = {
      onmessage: null as ((e: any) => void) | null,
      postMessage: (m: any) => {
        sent.push(m);
      },
      close: vi.fn(),
    };
    connect = vi.fn();
    disconnect = vi.fn();
    onprocessorerror: (() => void) | null = null;
    constructor() {
      node = this;
    }
  }
  vi.stubGlobal("AudioWorkletNode", Node);
  const send = (data: any) => node.port.onmessage?.({ data });
  return {
    context: context as unknown as AudioContext,
    sent,
    send,
    listeners,
    get node() {
      return node;
    },
    async until(type: string) {
      for (let i = 0; i < 30; i++) {
        await Promise.resolve();
        const m = sent.findLast((m) => m.type === type);
        if (m) return m;
      }
      throw new Error(`Missing ${type}`);
    },
  };
}
afterEach(() => vi.unstubAllGlobals());
describe("audio player lifecycle", () => {
  it("prepares before scheduling and resolves only after the worklet starts", async () => {
    const f = fixture(),
      player = await createAudioPlayer(f.context),
      pending = player.play(performancePlan()),
      load = await f.until("load");
    expect(f.sent.some((m) => m.type === "start")).toBe(false);
    f.send({ type: "ready", id: load.id });
    const start = await f.until("start");
    expect(start.when).toBeCloseTo(10.05);
    f.send({ type: "started", id: load.id, when: start.when });
    const handle = await pending;
    expect(handle.startTime).toBe(start.when);
    f.send({ type: "ended", id: load.id, reason: "ended" });
    expect(await handle.finished).toEqual({ reason: "ended" });
    player.dispose();
  });
  it("rejects a cancelled pending preparation and never schedules stale ready messages", async () => {
    const f = fixture(),
      player = await createAudioPlayer(f.context),
      pending = player.play(performancePlan()),
      load = await f.until("load");
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    player.stop();
    f.send({ type: "ready", id: load.id });
    await rejected;
    expect(f.sent.some((m) => m.type === "start")).toBe(false);
    player.dispose();
  });
  it("cancels requests suspended in context.resume()", async () => {
    const f = fixture();
    let resume!: () => void;
    (f.context.resume as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<void>((r) => (resume = r)),
    );
    const player = await createAudioPlayer(f.context),
      pending = player.play(performancePlan()),
      rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    player.stop();
    resume();
    await rejected;
    expect(f.sent.some((m) => m.type === "load")).toBe(false);
    player.dispose();
  });
  it("ignores stale messages when the latest request replaces an earlier one", async () => {
    const f = fixture(),
      player = await createAudioPlayer(f.context),
      first = player.play(performancePlan()),
      a = await f.until("load"),
      rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const second = player.play(performancePlan());
    await rejected;
    const b = await f.until("load");
    expect(b.id).not.toBe(a.id);
    f.send({ type: "ready", id: a.id });
    f.send({ type: "ready", id: b.id });
    const start = await f.until("start");
    expect(start.id).toBe(b.id);
    f.send({ type: "started", id: b.id, when: start.when });
    const handle = await second;
    handle.stop();
    f.send({ type: "ended", id: b.id, reason: "stopped" });
    expect((await handle.finished).reason).toBe("stopped");
    player.dispose();
  });
  it("surfaces preparation errors and rejects missed explicit deadlines", async () => {
    const f = fixture(),
      player = await createAudioPlayer(f.context),
      pending = player.play(performancePlan()),
      load = await f.until("load"),
      rejected = expect(pending).rejects.toThrow("bad input");
    f.send({ type: "error", id: load.id, message: "bad input" });
    await rejected;
    const late = player.play(performancePlan(), { when: 1 }),
      lateRejected = expect(late).rejects.toThrow("deadline");
    await Promise.resolve();
    const next = await f.until("load");
    f.send({ type: "ready", id: next.id });
    await lateRejected;
    player.dispose();
  });
  it("handles a fatal processor failure and rejects later requests immediately", async () => {
    const f = fixture(),
      player = await createAudioPlayer(f.context),
      pending = player.play(performancePlan());
    await f.until("load");
    const rejected = expect(pending).rejects.toThrow("processor failed");
    f.node.onprocessorerror();
    await rejected;
    await expect(player.play(performancePlan())).rejects.toThrow(
      "create a new player",
    );
    player.dispose();
  });
  it("settles preparation when the context closes", async () => {
    const f = fixture(),
      player = await createAudioPlayer(f.context);
    const next = player.play(performancePlan());
    await Promise.resolve();
    await f.until("load");
    const closed = expect(next).rejects.toThrow("closed");
    Object.defineProperty(f.context, "state", { value: "closed" });
    f.listeners.get("statechange")!();
    await closed;
    player.dispose();
  });
  it("snapshots validated data before an asynchronous resume", async () => {
    const f = fixture();
    let resume!: () => void;
    (f.context.resume as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<void>((r) => (resume = r)),
    );
    const player = await createAudioPlayer(f.context),
      plan = performancePlan(),
      frequency = plan.events[0]!.frequency;
    const pending = player.play(plan);
    (plan.events[0] as { frequency: number }).frequency = 1;
    resume();
    const load = await f.until("load");
    expect(load.input.events[0].frequency).toBe(frequency);
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    player.stop();
    await rejected;
    player.dispose();
  });
  it("disposes connections and rejects further play calls", async () => {
    const f = fixture(),
      player = await createAudioPlayer(f.context);
    player.dispose();
    player.dispose();
    expect(f.node.disconnect).toHaveBeenCalledOnce();
    expect(f.node.port.close).toHaveBeenCalledOnce();
    expect(f.listeners.size).toBe(0);
    await expect(player.play(performancePlan())).rejects.toThrow("disposed");
  });
  it("shares worklet loading for one context and lets failed loads retry", async () => {
    const f = fixture();
    const a = await createAudioPlayer(f.context),
      b = await createAudioPlayer(f.context);
    expect(f.context.audioWorklet.addModule).toHaveBeenCalledOnce();
    a.dispose();
    b.dispose();
    const g = fixture();
    (
      g.context.audioWorklet.addModule as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("network"));
    await expect(createAudioPlayer(g.context)).rejects.toThrow("network");
    const c = await createAudioPlayer(g.context);
    expect(g.context.audioWorklet.addModule).toHaveBeenCalledTimes(2);
    c.dispose();
  });
});
