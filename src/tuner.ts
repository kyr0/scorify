/// <reference lib="dom" />
import { pitchToMidi } from "./pitch.js";
import { validateInstrument } from "./fretted.js";
import { createPitchTracker, PITCH_PROCESSOR_NAME } from "./pitch-detect.js";
import type { FrettedInstrument } from "./fretted.js";
import type { PitchReading, PitchTrackerOptions } from "./pitch-detect.js";
export * from "./pitch-detect.js";
const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export interface TuningTarget {
  readonly stringId: string;
  /** Conventional tab number, 1 at the treble edge. */
  readonly number: number;
  /** Sounding open pitch with the capo applied, e.g. "E2"; the instrument's own spelling without a capo. */
  readonly pitch: string;
  readonly midi: number;
  readonly frequency: number;
}
export interface TuningReading {
  readonly target: TuningTarget;
  /** Signed distance from the target, cents (positive: sharp). */
  readonly cents: number;
  readonly inTune: boolean;
}
export interface ChromaticNote {
  readonly pitch: string;
  readonly midi: number;
  /** The equal-tempered frequency of that note. */
  readonly frequency: number;
  readonly cents: number;
}
const frequencyOf = (midi: number, concertAHz: number) => concertAHz * 2 ** ((midi - 69) / 12);
const nameOf = (midi: number) => `${SHARPS[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
function concert(concertAHz: number): number {
  if (!Number.isFinite(concertAHz) || concertAHz < 300 || concertAHz > 600)
    throw new RangeError("Concert A must be in [300, 600] Hz");
  return concertAHz;
}
/** Signed cents from `reference` to `frequency`. */
export function centsFrom(frequency: number, reference: number): number {
  if (!(frequency > 0) || !(reference > 0)) throw new RangeError("Frequencies must be positive");
  return 1200 * Math.log2(frequency / reference);
}
/** The open strings to tune, in physical string order, as they should sound (capo included). */
export function tuningTargets(
  instrument: FrettedInstrument,
  options: { readonly concertAHz?: number } = {},
): TuningTarget[] {
  validateInstrument(instrument);
  const a4 = concert(options.concertAHz ?? 440);
  return instrument.strings.map((s) => {
    const midi = pitchToMidi(s.openPitch) + s.capoFret;
    return {
      stringId: s.id,
      number: s.number,
      pitch: s.capoFret ? nameOf(midi) : s.openPitch,
      midi,
      frequency: frequencyOf(midi, a4),
    };
  });
}
/** The target string closest to a frequency (in cents), and how far off it is. */
export function nearestTarget(
  frequency: number,
  targets: readonly TuningTarget[],
  options: { readonly toleranceCents?: number } = {},
): TuningReading | null {
  const tolerance = options.toleranceCents ?? 5;
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 50)
    throw new RangeError("Tolerance must be in [0, 50] cents");
  if (!(frequency > 0) || !targets.length) return null;
  let best: TuningReading | null = null;
  for (const target of targets) {
    const cents = centsFrom(frequency, target.frequency);
    if (!best || Math.abs(cents) < Math.abs(best.cents))
      best = { target, cents, inTune: Math.abs(cents) <= tolerance };
  }
  return best;
}
/** The nearest equal-tempered note, for chromatic tuning. */
export function chromaticNote(frequency: number, concertAHz = 440): ChromaticNote {
  const a4 = concert(concertAHz);
  if (!(frequency > 0)) throw new RangeError("Frequency must be positive");
  const exact = 69 + 12 * Math.log2(frequency / a4),
    midi = Math.round(exact);
  return { pitch: nameOf(midi), midi, frequency: frequencyOf(midi, a4), cents: (exact - midi) * 100 };
}

export interface PitchInputReading extends PitchReading {
  /** AudioContext time at the end of the analysed window. */
  readonly contextTime: number;
}
export interface PitchInputOptions extends Omit<PitchTrackerOptions, "sampleRate"> {
  /** Analyse this stream instead of asking for the microphone; it is not stopped by `stop()`. */
  readonly stream?: MediaStream;
  /** Or analyse any node of the same context. */
  readonly source?: AudioNode;
  /** Extra microphone constraints; echo cancellation, noise suppression and gain control are off by default. */
  readonly constraints?: MediaTrackConstraints;
  readonly workletUrl?: string | URL;
  readonly onPitch?: (reading: PitchInputReading) => void;
  readonly onError?: (error: Error) => void;
}
export interface PitchInput {
  readonly node: AudioWorkletNode;
  /** The microphone stream this input opened, or the one passed in; null for a node source. */
  readonly stream: MediaStream | null;
  readonly stopped: boolean;
  /** Restart detection with new tracker options (for example the range of another instrument). */
  configure(options: Omit<PitchTrackerOptions, "sampleRate">): void;
  /** Disconnect, end the processor and release a microphone this input opened. Idempotent. */
  stop(): void;
}
const modules = new WeakMap<BaseAudioContext, Map<string, Promise<void>>>();
const trackerOptions = (o: PitchInputOptions) => {
  const { stream: _s, source: _n, constraints: _c, workletUrl: _w, onPitch: _p, onError: _e, ...rest } = o;
  return rest;
};
/**
 * Detect the pitch of live audio in real time: the microphone (or a given stream or node) feeds the pitch-detector
 * AudioWorklet, which posts a reading per hop to `onPitch`. Ask from a user gesture: the browser asks the person for
 * the microphone, and an AudioContext may need resuming. Needs a secure context (HTTPS or localhost).
 */
export async function createPitchInput(
  context: AudioContext,
  options: PitchInputOptions = {},
): Promise<PitchInput> {
  if (context.state === "closed") throw new Error("AudioContext is closed");
  // Invalid options fail before the browser asks for the microphone.
  const processorOptions = trackerOptions(options);
  createPitchTracker({ ...processorOptions, sampleRate: context.sampleRate });
  const url = String(options.workletUrl ?? new URL("./pitch-worklet.mjs", import.meta.url));
  let loaded = modules.get(context);
  if (!loaded) {
    loaded = new Map();
    modules.set(context, loaded);
  }
  let module = loaded.get(url);
  if (!module) {
    module = context.audioWorklet.addModule(url);
    loaded.set(url, module);
    module.catch(() => loaded!.delete(url));
  }
  await module;
  let opened: MediaStream | null = null;
  if (!options.stream && !options.source) {
    if (!globalThis.navigator?.mediaDevices?.getUserMedia)
      throw new Error("Microphone input needs a secure context (HTTPS or localhost) and getUserMedia");
    opened = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, ...options.constraints },
    });
  }
  const stream = options.stream ?? opened;
  try {
    const source = options.source ?? new MediaStreamAudioSourceNode(context, { mediaStream: stream! });
    const node = new AudioWorkletNode(context, PITCH_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions,
    });
    // The processor outputs silence; a muted path to the destination keeps it rendered in every browser.
    const sink = new GainNode(context, { gain: 0 });
    source.connect(node);
    node.connect(sink).connect(context.destination);
    let stopped = false;
    node.port.onmessage = (event) => {
      const m = event.data as { type?: string; message?: string } & PitchInputReading;
      if (stopped) return;
      if (m.type === "pitch") {
        const { type: _type, ...reading } = m;
        options.onPitch?.(reading);
      } else if (m.type === "error") options.onError?.(new Error(m.message ?? "Pitch processor error"));
    };
    return {
      node,
      stream,
      get stopped() {
        return stopped;
      },
      configure(next) {
        if (stopped) throw new Error("Pitch input is stopped");
        createPitchTracker({ ...next, sampleRate: context.sampleRate });
        node.port.postMessage({ type: "configure", options: next });
      },
      stop() {
        if (stopped) return;
        stopped = true;
        node.port.postMessage({ type: "stop" });
        try {
          source.disconnect(node);
        } catch {
          /* already disconnected */
        }
        node.disconnect();
        sink.disconnect();
        for (const track of opened?.getTracks() ?? []) track.stop();
      },
    };
  } catch (error) {
    for (const track of opened?.getTracks() ?? []) track.stop();
    throw error;
  }
}
