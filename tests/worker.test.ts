import { it, expect, vi } from "vitest";
import {
  createWorkerClient,
  installWorkerEndpoint,
  createScore,
  parsePitch,
  q,
  concertUkulele,
  classicalGuitar,
} from "../src/index.js";
import type { MessagePortLike, WorkerResponse } from "../src/index.js";
class Port implements MessagePortLike {
  peer?: Port;
  listeners = new Set<(event: { data: unknown }) => void>();
  messages: unknown[] = [];
  postMessage(message: unknown): void {
    this.messages.push(message);
    queueMicrotask(() =>
      this.peer?.listeners.forEach((fn) => fn({ data: message })),
    );
  }
  addEventListener(
    _type: "message",
    listener: (event: { data: unknown }) => void,
  ): void {
    this.listeners.add(listener);
  }
  removeEventListener(
    _type: "message",
    listener: (event: { data: unknown }) => void,
  ): void {
    this.listeners.delete(listener);
  }
}
const score = () =>
  createScore([
    {
      id: "a",
      pitch: parsePitch("C4"),
      onset: q(0),
      duration: q(1),
      partId: "p",
      voiceId: "v",
    },
  ]);
it("runs the serializable endpoint and cleans up listeners", async () => {
  const main = new Port(),
    worker = new Port();
  main.peer = worker;
  worker.peer = main;
  const cleanup = installWorkerEndpoint(worker),
    client = createWorkerClient(main);
  const result = await client.arrange(score(), {
    instrument: concertUkulele(),
  });
  expect(result.status).toBe("success");
  client.dispose();
  cleanup();
  expect(main.listeners.size).toBe(0);
  expect(worker.listeners.size).toBe(0);
});
it("supersedes old requests and ignores stale responses", async () => {
  const main = new Port(),
    worker = new Port();
  main.peer = worker;
  worker.peer = main;
  const cleanup = installWorkerEndpoint(worker),
    client = createWorkerClient(main);
  const first = client.arrange(score(), { instrument: concertUkulele() }),
    second = client.arrange(score(), { mode: "unconstrained" });
  expect((await first).status).toBe("cancelled");
  expect((await second).status).toBe("success");
  worker.postMessage({
    type: "result",
    id: 1,
    result: { status: "cancelled" },
  });
  await Promise.resolve();
  client.dispose();
  cleanup();
});
it("rejects unserializable scoring hooks before sending", () => {
  const main = new Port(),
    client = createWorkerClient(main);
  expect(() =>
    client.arrange(score(), { scoring: { id: "x", cost: () => 0 } }),
  ).toThrow(/serializable/);
  expect(main.messages).toHaveLength(0);
  client.dispose();
});
it("posts progress per time slice and reads cancel messages during a long search", async () => {
  const main = new Port(),
    worker = new Port();
  main.peer = worker;
  worker.peer = main;
  const cleanup = installWorkerEndpoint(worker),
    responses: WorkerResponse[] = [];
  main.addEventListener("message", (e) =>
    responses.push(e.data as WorkerResponse),
  );
  const chords = [
    ["C3", "E4", "G4"],
    ["A2", "C4", "E4"],
    ["F3", "A3", "C5"],
    ["G3", "B3", "D5"],
  ];
  const notes = Array.from({ length: 64 }, (_, i) =>
    chords[i % 4]!.map((pitch, k) => ({
      id: `n${i}-${k}`,
      pitch: parsePitch(pitch),
      onset: q(i),
      duration: q(1),
      partId: "p",
      voiceId: "v",
    })),
  ).flat();
  main.postMessage({
    type: "arrange",
    id: 1,
    score: createScore(notes),
    options: {
      instrument: classicalGuitar(),
      search: { strategy: "exhaustive", maxExpandedStates: 50_000_000 },
    },
  });
  await vi.waitFor(
    () => expect(responses.some((r) => r.type === "progress")).toBe(true),
    { timeout: 5000 },
  );
  main.postMessage({ type: "cancel", id: 1 });
  await vi.waitFor(
    () => expect(responses.some((r) => r.type === "result")).toBe(true),
    { timeout: 5000 },
  );
  const result = responses.find((r) => r.type === "result");
  expect(result?.type === "result" && result.result.status).toBe("cancelled");
  cleanup();
});
