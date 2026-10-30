/**
 * Practice sounds beside the strings: a sung line as a soft synthesized voice, and a metronome of a kick and a clap.
 * Host-neutral DSP, rendered offline sample by sample. A metronome click is a pure function of the time since it
 * started (its noise is seeded by its time), so any span of a render equals the same span of a longer one. The voice's
 * oscillators are too; only its lowpass filter carries state, which settles within milliseconds of a span's start.
 */
export interface GuideAudio {
  readonly sampleRate: number;
  readonly channels: readonly [Float32Array, Float32Array];
  readonly durationSeconds: number;
}
/** The part of the timeline to render. */
export interface GuideSpan {
  /** Where the rendered audio starts on the timeline, in seconds (default 0). */
  readonly startSeconds?: number;
  /** Seconds to render, in (0, 3600]. */
  readonly durationSeconds: number;
  /** Default 48000. */
  readonly sampleRate?: number;
  /** Linear output gain in [0, 4] (default 1). */
  readonly gain?: number;
}
/** A sung note at its sounding pitch. */
export interface GuideNote {
  readonly onsetSeconds: number;
  readonly endSeconds: number;
  /** Hertz, in [20, 5000]. */
  readonly frequency: number;
  /** Loudness in [0, 1] (default 1). */
  readonly velocity?: number;
}
export interface GuideVoiceOptions extends GuideSpan {
  /** The voice's lowpass corner in hertz, in [200, 20000] (default 1800): the overtones above it are softened. */
  readonly lowpassHz?: number;
}
export type ClickKind = "kick" | "clap";
/** One metronome sound; an accented one (a bar's first beat) is louder. */
export interface Click {
  readonly atSeconds: number;
  readonly kind: ClickKind;
  readonly accent?: boolean;
}
/** One click of a bar's pattern: its beat (in the meter's beats, from 0), sound and accent. */
export interface PatternClick {
  readonly beat: number;
  readonly kind: ClickKind;
  readonly accent: boolean;
}

/**
 * The voice: a fundamental and three weaker overtones (an "oo" more than an "ee"), a vibrato that sets in after a
 * quarter of a second, a soft attack and release, then a two-pole lowpass, so it sings along without biting.
 */
export const GUIDE_VOICE = {
  harmonics: [1, 0.32, 0.14, 0.06],
  attackSeconds: 0.04,
  releaseSeconds: 0.09,
  vibratoHz: 5.2,
  vibratoCents: 16,
  vibratoDelaySeconds: 0.25,
  vibratoRiseSeconds: 0.3,
  lowpassHz: 1800,
  lowpassQ: 0.6,
  level: 0.07,
} as const;
/**
 * The metronome, after defuss-shadcn's envelope compressor demo: a sine kick falling from 120 to 45 Hz in 0.15 s and
 * dying away in 0.4 s; a clap of white noise through a 1.8 kHz bandpass, three short bursts and a 0.18 s tail; each
 * through a compressor (−24 dB threshold, 4:1, 6 dB knee, 5 ms attack, 150 ms release, 6 dB makeup).
 */
export const GUIDE_METRONOME = {
  kick: { fromHz: 120, toHz: 45, sweepSeconds: 0.15, seconds: 0.4, level: 0.9 },
  clap: { bandpassHz: 1800, q: 1, bursts: [0, 0.011, 0.022], burstSeconds: 0.012, tailAt: 0.033, tailSeconds: 0.18, level: 0.6 },
  compressor: { thresholdDb: -24, ratio: 4, kneeDb: 6, attackSeconds: 0.005, releaseSeconds: 0.15, makeupDb: 6 },
  unaccented: 0.7,
  level: 0.16,
} as const;
const FLOOR = 0.001,
  MAX_SECONDS = 3600;

function frames(span: GuideSpan): { sampleRate: number; start: number; length: number; gain: number } {
  const sampleRate = span.sampleRate ?? 48000,
    start = span.startSeconds ?? 0,
    gain = span.gain ?? 1;
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError("Sample rate must be in [8000, 192000]");
  if (!Number.isFinite(start)) throw new RangeError("startSeconds must be finite");
  if (!Number.isFinite(span.durationSeconds) || span.durationSeconds <= 0 || span.durationSeconds > MAX_SECONDS)
    throw new RangeError(`durationSeconds must be in (0, ${MAX_SECONDS}]`);
  if (!Number.isFinite(gain) || gain < 0 || gain > 4) throw new RangeError("gain must be in [0, 4]");
  return { sampleRate, start, length: Math.ceil(span.durationSeconds * sampleRate), gain };
}
const audioOf = (mono: Float32Array, sampleRate: number): GuideAudio => ({
  sampleRate,
  channels: [mono, mono.slice()],
  durationSeconds: mono.length / sampleRate,
});
/** RBJ biquad coefficients, normalized: [b0, b1, b2, a1, a2]. */
function biquad(type: "lowpass" | "bandpass", hz: number, q: number, sampleRate: number): readonly number[] {
  const w = (2 * Math.PI * Math.min(hz, sampleRate * 0.45)) / sampleRate,
    alpha = Math.sin(w) / (2 * q),
    cos = Math.cos(w),
    a0 = 1 + alpha;
  const b = type === "lowpass" ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2] : [alpha, 0, -alpha];
  return [b[0]! / a0, b[1]! / a0, b[2]! / a0, (-2 * cos) / a0, (1 - alpha) / a0];
}
/** Filters in place (direct form I). */
function filter(samples: Float32Array, [b0, b1, b2, a1, a2]: readonly number[]): void {
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]!,
      y = b0! * x + b1! * x1 + b2! * x2 - a1! * y1 - a2! * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    samples[i] = y;
  }
}

/** Renders a sung line as the guide voice (mono, in both channels). Notes may overlap. Throws RangeError on bad input. */
export function renderGuideVoice(notes: readonly GuideNote[], options: GuideVoiceOptions): GuideAudio {
  const { sampleRate, start, length, gain } = frames(options),
    lowpassHz = options.lowpassHz ?? GUIDE_VOICE.lowpassHz;
  if (!Number.isFinite(lowpassHz) || lowpassHz < 200 || lowpassHz > 20000) throw new RangeError("lowpassHz must be in [200, 20000]");
  const out = new Float32Array(length),
    end = start + length / sampleRate,
    v = GUIDE_VOICE,
    depth = 2 ** (v.vibratoCents / 1200) - 1;
  for (const note of notes) {
    const { onsetSeconds: onset, endSeconds: stop, frequency, velocity = 1 } = note;
    if (!Number.isFinite(onset) || !Number.isFinite(stop) || stop < onset) throw new RangeError("A guide note must end at or after its onset");
    if (!Number.isFinite(frequency) || frequency < 20 || frequency > 5000) throw new RangeError("A guide note's frequency must be in [20, 5000] Hz");
    if (!Number.isFinite(velocity) || velocity < 0 || velocity > 1) throw new RangeError("A guide note's velocity must be in [0, 1]");
    const last = stop + v.releaseSeconds;
    if (last <= start || onset >= end) continue;
    const from = Math.max(0, Math.ceil((onset - start) * sampleRate)),
      to = Math.min(length, Math.ceil((last - start) * sampleRate)),
      // Phase modulation whose index gives the vibrato's pitch deviation; harmonics above the filter's reach are skipped.
      index = (frequency * depth) / v.vibratoHz,
      partials = v.harmonics.filter((_, k) => frequency * (k + 1) < Math.min(sampleRate * 0.45, 12000)),
      norm = (v.level * velocity) / v.harmonics.reduce((sum, h) => sum + h, 0);
    for (let i = from; i < to; i++) {
      const t = start + i / sampleRate - onset;
      if (t < 0) continue;
      const attack = t < v.attackSeconds ? Math.sin(((t / v.attackSeconds) * Math.PI) / 2) ** 2 : 1,
        release = t + onset > stop ? Math.max(0, 1 - (t + onset - stop) / v.releaseSeconds) : 1,
        rise = Math.min(1, Math.max(0, (t - v.vibratoDelaySeconds) / v.vibratoRiseSeconds)),
        phase = 2 * Math.PI * frequency * t + rise * index * Math.sin(2 * Math.PI * v.vibratoHz * t);
      let sample = 0;
      for (let k = 0; k < partials.length; k++) sample += partials[k]! * Math.sin((k + 1) * phase);
      out[i]! += sample * attack * release * norm;
    }
  }
  filter(out, biquad("lowpass", lowpassHz, v.lowpassQ, sampleRate));
  if (gain !== 1) for (let i = 0; i < length; i++) out[i]! *= gain;
  return audioOf(out, sampleRate);
}

/**
 * The metronome's clicks in one bar of a meter: a kick on the first beat (accented); in an even number of pulses a kick
 * on every other one and a clap between (4/4: kick, clap, kick, clap), otherwise claps after the first (3/4: kick,
 * clap, clap). Compound meters (6/8, 9/8, 12/8) click on their dotted pulses.
 */
export function clickPattern(numerator: number, denominator: number): PatternClick[] {
  if (!Number.isSafeInteger(numerator) || numerator < 1 || numerator > 32) throw new RangeError("Meter numerator must be in [1, 32]");
  if (![1, 2, 4, 8, 16, 32].includes(denominator)) throw new RangeError("Meter denominator must be a power of two up to 32");
  const step = denominator >= 8 && numerator > 3 && numerator % 3 === 0 ? 3 : 1,
    pulses = numerator / step;
  return Array.from({ length: pulses }, (_, p) => ({
    beat: p * step,
    kind: p === 0 || (pulses % 2 === 0 && p % 2 === 0) ? ("kick" as const) : ("clap" as const),
    accent: p === 0,
  }));
}
/** One bar of clicks that ends at `endSeconds`, at `beatSeconds` a beat: a count-in before a song or a loop. */
export function countIn(numerator: number, denominator: number, beatSeconds: number, endSeconds: number): Click[] {
  if (!Number.isFinite(beatSeconds) || beatSeconds <= 0 || beatSeconds > 10) throw new RangeError("beatSeconds must be in (0, 10]");
  if (!Number.isFinite(endSeconds)) throw new RangeError("endSeconds must be finite");
  return clickPattern(numerator, denominator).map(({ beat, kind, accent }) => ({ atSeconds: endSeconds - (numerator - beat) * beatSeconds, kind, accent }));
}

/** A seeded white-noise generator (mulberry32) in [-1, 1). */
function noise(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}
/** One click from its start, compressed, at the given sample rate. */
function clickSamples(kind: ClickKind, accent: boolean, atSeconds: number, sampleRate: number): Float32Array {
  const m = GUIDE_METRONOME,
    level = (accent ? 1 : m.unaccented) * m.level;
  let out: Float32Array;
  if (kind === "kick") {
    const { fromHz, toHz, sweepSeconds, seconds } = m.kick,
      ratio = toHz / fromHz,
      sweepPhase = (fromHz * sweepSeconds * (ratio - 1)) / Math.log(ratio);
    out = new Float32Array(Math.ceil(seconds * sampleRate));
    for (let i = 0; i < out.length; i++) {
      const t = i / sampleRate,
        // The integral of an exponential sweep, then the steady low tone.
        cycles = t < sweepSeconds ? (fromHz * sweepSeconds * (ratio ** (t / sweepSeconds) - 1)) / Math.log(ratio) : sweepPhase + toHz * (t - sweepSeconds);
      out[i] = Math.sin(2 * Math.PI * cycles) * FLOOR ** (t / seconds) * m.kick.level;
    }
  } else {
    const { bandpassHz, q, bursts, burstSeconds, tailAt, tailSeconds } = m.clap,
      random = noise(Math.round(atSeconds * 48000) ^ 0x5eed);
    out = new Float32Array(Math.ceil((tailAt + tailSeconds) * sampleRate));
    for (let i = 0; i < out.length; i++) {
      const t = i / sampleRate;
      let envelope = t >= tailAt ? FLOOR ** ((t - tailAt) / tailSeconds) : 0;
      for (const b of bursts) if (t >= b && t < b + burstSeconds) envelope = Math.max(envelope, FLOOR ** ((t - b) / burstSeconds));
      out[i] = random() * envelope * m.clap.level;
    }
    filter(out, biquad("bandpass", bandpassHz, q, sampleRate));
    // The bandpass loses level; the clap's bursts come back to about the kick's peak.
    for (let i = 0; i < out.length; i++) out[i]! *= 2.5;
  }
  compress(out, sampleRate);
  for (let i = 0; i < out.length; i++) out[i]! *= level;
  return out;
}
/** A feed-forward compressor with a soft knee, in place. */
function compress(samples: Float32Array, sampleRate: number): void {
  const { thresholdDb: threshold, ratio, kneeDb: knee, attackSeconds, releaseSeconds, makeupDb } = GUIDE_METRONOME.compressor,
    attack = Math.exp(-1 / (attackSeconds * sampleRate)),
    release = Math.exp(-1 / (releaseSeconds * sampleRate));
  let reduction = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]!,
      level = 20 * Math.log10(Math.abs(x) + 1e-9),
      over = level - threshold,
      target = 2 * over < -knee ? 0 : 2 * Math.abs(over) <= knee ? ((1 / ratio - 1) * (over + knee / 2) ** 2) / (2 * knee) : (1 / ratio - 1) * over,
      coefficient = target < reduction ? attack : release;
    reduction = coefficient * reduction + (1 - coefficient) * target;
    samples[i] = x * 10 ** ((reduction + makeupDb) / 20);
  }
}
/** Renders metronome clicks (mono, in both channels). Throws RangeError on bad input. */
export function renderClicks(clicks: readonly Click[], span: GuideSpan): GuideAudio {
  const { sampleRate, start, length, gain } = frames(span),
    out = new Float32Array(length);
  for (const { atSeconds, kind, accent = false } of clicks) {
    if (!Number.isFinite(atSeconds)) throw new RangeError("A click's time must be finite");
    if (kind !== "kick" && kind !== "clap") throw new RangeError("A click is a kick or a clap");
    const offset = Math.round((atSeconds - start) * sampleRate);
    if (offset >= length) continue;
    const samples = clickSamples(kind, accent, atSeconds, sampleRate);
    for (let i = Math.max(0, -offset); i < samples.length && offset + i < length; i++) out[offset + i]! += samples[i]! * gain;
  }
  return audioOf(out, sampleRate);
}
