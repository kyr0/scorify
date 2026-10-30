import { normalizeScore, soundingNotes, pitchString } from "./model.js";
import { pitchToMidi } from "./pitch.js";
import {
  q,
  compareQ,
  keyQ,
  addQ,
  mulQ,
  secondsAt,
  quartersAtSeconds,
} from "./time.js";
import { compilePlayer } from "./profiles.js";
import { validateInstrument } from "./fretted.js";
import {
  createFrettedAdapter,
  realizeFrettedAssignments,
} from "./fingering.js";
import { validateFrettedArrangement } from "./validate.js";
import {
  finiteRange,
  validateTone,
  signedRandom,
  seedHash,
  ukuleleAudioPreset,
  classicalGuitarAudioPreset,
} from "./audio/types.js";
import type { Score, SoundingNote, Meter } from "./model.js";
import type { Q } from "./time.js";
import type { PlayerProfile } from "./profiles.js";
import type { FrettedInstrument } from "./fretted.js";
import type {
  FrettedAssignment,
  FrettedAnnotation,
  FingerContact,
  FrettedRealization,
} from "./fingering.js";
import type { ArrangementSuccess } from "./arrange.js";
import type {
  PluckTone,
  StringExcitation,
  SynthesisInput,
  AudioPreset,
} from "./audio/types.js";
export interface HumanizeOptions {
  readonly amount?: number;
  readonly timingMs?: number;
  readonly stringTimingMs?: number;
  readonly velocity?: number;
  readonly brightness?: number;
  readonly pluckPosition?: number;
  readonly decay?: number;
  /** Depth of the played dynamics: bar accents, melody and bass over inner notes, a strum's taper. */
  readonly dynamics?: number;
  /** Bound of the slow per-string pitch drift, in cents; always below one cent. */
  readonly driftCents?: number;
}
export interface StrumOptions {
  readonly direction?: "down" | "up";
  /** First to last struck string. Default: from the local tempo and the strings the stroke covers. */
  readonly spreadSeconds?: number;
  readonly curve?: number;
  /** Fraction of the sweep's time that falls on the notated onset: 0 starts on it, 0.5 centers the sweep on it. */
  readonly anchor?: number;
  /** Velocity lost from the first to the last struck string at full dynamics (default 0.4 down, 0.3 up). */
  readonly taper?: number;
  /** Only these strings enter the sweep; other score attacks remain individual plucks. */
  readonly stringIds?: readonly string[];
  readonly velocity?: number;
  readonly muted?: boolean;
}
export interface StrumStroke extends StrumOptions {
  readonly id: string;
  readonly at: Q;
}
export interface PerformanceOptions {
  readonly seed?: string | number;
  readonly humanize?: number | HumanizeOptions;
  readonly strum?: StrumOptions | false;
  readonly strokes?: readonly StrumStroke[];
  readonly leadInSeconds?: number;
  readonly preset?: AudioPreset;
  readonly tone?: Partial<PluckTone>;
  readonly stringTone?: Readonly<Record<string, Partial<PluckTone>>>;
  readonly noteTone?: Readonly<Record<string, Partial<PluckTone>>>;
  readonly timingPolicy?: "constrain" | "strict";
  readonly maxNotes?: number;
  /**
   * Check the player's time-based limits (string attacks per second, shift and finger speed, finger setup time) at
   * the performance's own tempo (default true). False plays a fingering that was searched and validated at another
   * tempo, faster or slower, as a playback speed: the fingering itself (strings, frets, fingers, span, barres, notes
   * at once) and every check of the performance still apply, and the plan records that the time limits were lifted.
   */
  readonly timeLimits?: boolean;
}
export interface PerformanceNote extends StringExcitation {
  readonly detuneCents: number;
  readonly noteIds: readonly string[];
  readonly nominalOnsetSeconds: number;
  readonly nominalEndSeconds: number;
  readonly offsetSeconds: number;
  readonly assignment: FrettedAssignment;
  readonly contact: FingerContact | null;
  readonly strokeId: string | null;
}
export interface PerformedStroke {
  readonly id: string;
  readonly at: Q;
  readonly direction: "down" | "up";
  readonly noteIds: readonly string[];
  readonly spreadSeconds: number;
  readonly curve: number;
  readonly anchor: number;
  readonly taper: number;
}
export interface PerformancePlan extends SynthesisInput {
  readonly schemaVersion: 1;
  readonly version: "scorify-performance-1";
  readonly score: Score;
  readonly instrument: FrettedInstrument;
  readonly profile: PlayerProfile;
  readonly annotations: readonly FrettedAnnotation[];
  readonly events: readonly PerformanceNote[];
  readonly strokes: readonly PerformedStroke[];
  readonly seed: string | number;
  readonly leadInSeconds: number;
  readonly preset: AudioPreset;
  readonly humanization: {
    readonly requested: Required<HumanizeOptions>;
    readonly timingScale: number;
  };
  readonly diagnostics: readonly string[];
  readonly constraints: { readonly valid: true; readonly model: string };
  /** "lifted": validated without the player's time-based limits (`timeLimits: false`). */
  readonly timeLimits?: "lifted";
}
export type PerformanceResult =
  | { readonly status: "success"; readonly performance: PerformancePlan }
  | {
      readonly status: "invalid-input" | "unplayable";
      readonly diagnostics: readonly string[];
    };
/** A player's limits without the time-based ones: string attacks per second, shift and finger speed, finger setup. */
function untimed(p: PlayerProfile): PlayerProfile {
  return compilePlayer({
    level: p.level,
    complexity: p.complexity,
    flexibility: p.flexibility,
    // A finger-speed limit measures distances in millimetres, so it is lifted only where the player has one.
    overrides: {
      ...p,
      maxAttacksPerSecond: Number.MAX_SAFE_INTEGER,
      maxShiftFretsPerSecond: Number.MAX_SAFE_INTEGER,
      fingerSetupSeconds: 0,
      ...(p.maxFingerSpeedMmPerSecond !== undefined ? { maxFingerSpeedMmPerSecond: Number.MAX_SAFE_INTEGER } : {}),
    },
  });
}
const bounded = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
function notatedDurationSeconds(score: Score): number {
  let end = q(0);
  for (const event of [...score.notes, ...score.rests]) {
    const candidate = addQ(event.onset, event.duration);
    if (compareQ(candidate, end) > 0) end = candidate;
  }
  return secondsAt(end, score.tempoMap);
}
function humanization(
  input: PerformanceOptions["humanize"],
): Required<HumanizeOptions> {
  const o = typeof input === "number" ? { amount: input } : (input ?? {});
  const h = {
    amount: o.amount ?? 0.5,
    timingMs: o.timingMs ?? 8,
    stringTimingMs: o.stringTimingMs ?? 2,
    velocity: o.velocity ?? 0.08,
    brightness: o.brightness ?? 0.06,
    pluckPosition: o.pluckPosition ?? 0.02,
    decay: o.decay ?? 0.05,
    dynamics: o.dynamics ?? 1,
    driftCents: o.driftCents ?? 0.5,
  };
  finiteRange(h.amount, 0, 1, "Humanization");
  finiteRange(h.timingMs, 0, 50, "Stroke jitter");
  finiteRange(h.stringTimingMs, 0, 20, "String jitter");
  for (const k of [
    "velocity",
    "brightness",
    "pluckPosition",
    "decay",
    "dynamics",
  ] as const)
    finiteRange(h[k], 0, 1, k);
  finiteRange(h.driftCents, 0, 0.99, "Pitch drift");
  return h;
}
const value = (x: Q) => x[0] / x[1];
/**
 * How strong a score time is in its bar: 1 on the downbeat, 0.6 on the middle of an even bar of four or more beats,
 * 0.3 on other beats, -0.3 halfway between beats (a third of a compound beat), -0.6 elsewhere. A first bar that is
 * shorter than the next one is a pickup and counts as the end of a bar of the next meter.
 */
export function metricWeight(at: Q, meters: readonly Meter[]): number {
  const t = value(at);
  let i = meters.length - 1;
  while (i > 0 && value(meters[i]!.at) > t + 1e-9) i--;
  const meter = meters[i];
  if (!meter) return 0;
  const bar = (m: Meter) => (m.numerator * 4) / m.denominator,
    next = meters[i + 1];
  let shape = meter,
    position = t - value(meter.at);
  if (
    i === 0 &&
    next &&
    Math.abs(value(next.at) - value(meter.at) - bar(meter)) < 1e-9 &&
    bar(meter) < bar(next)
  ) {
    shape = next;
    position += bar(next) - bar(meter);
  }
  const length = bar(shape),
    compound =
      shape.denominator >= 8 && shape.numerator % 3 === 0 && shape.numerator > 3,
    beat = (compound ? 12 : 4) / shape.denominator,
    on = (x: number, unit: number) =>
      Math.abs(x / unit - Math.round(x / unit)) < 1e-6;
  position = ((position % length) + length) % length;
  if (position < 1e-6 || length - position < 1e-6) return 1;
  if (on(position, beat)) {
    const beats = Math.round(length / beat);
    return beats >= 4 && beats % 2 === 0 && on(position, length / 2) ? 0.6 : 0.3;
  }
  return on(position, beat / (compound ? 3 : 2)) ? -0.3 : -0.6;
}
/**
 * A strum's sweep time when none is given: about a twentieth of a quarter note across all strings, between 12 and
 * 60 ms, so faster music strums faster; up-strokes are a fifth quicker, and a stroke over fewer strings is shorter.
 */
export function strumSweepSeconds(
  quarterSeconds: number,
  direction: "down" | "up",
  coveredStrings: number,
  stringCount: number,
): number {
  if (stringCount < 2 || coveredStrings < 1) return 0;
  return (
    bounded(0.05 * quarterSeconds, 0.012, 0.06) *
    (direction === "up" ? 0.8 : 1) *
    (Math.min(coveredStrings, stringCount - 1) / (stringCount - 1))
  );
}
/** Slow drift of one string's tuning over the performance, within ±bound cents (two incommensurate cycles). */
function driftCents(
  seed: string | number,
  stringId: string,
  seconds: number,
  bound: number,
): number {
  if (!bound) return 0;
  const phase = (channel: string) =>
    (seedHash(seed, stringId, channel) / 4294967296) * 2 * Math.PI;
  return (
    bound *
    (0.65 * Math.sin((2 * Math.PI * seconds) / 23 + phase("drift-slow")) +
      0.35 * Math.sin((2 * Math.PI * seconds) / 7.3 + phase("drift-fast")))
  );
}
function strumOptions(
  input: StrumOptions,
  instrument: FrettedInstrument,
): Required<Omit<StrumOptions, "stringIds" | "spreadSeconds">> & {
  spreadSeconds?: number;
  stringIds?: readonly string[];
} {
  const up = input.direction === "up";
  const o = {
    direction: input.direction ?? "down",
    ...(input.spreadSeconds !== undefined
      ? { spreadSeconds: input.spreadSeconds }
      : {}),
    curve: input.curve ?? 1,
    anchor: input.anchor ?? 0.5,
    taper: input.taper ?? (up ? 0.3 : 0.4),
    velocity: input.velocity ?? (up ? 0.85 : 1),
    muted: input.muted ?? false,
    ...(input.stringIds ? { stringIds: [...input.stringIds] } : {}),
  };
  if (!["down", "up"].includes(o.direction) || typeof o.muted !== "boolean")
    throw new RangeError("Invalid stroke");
  if (o.spreadSeconds !== undefined)
    finiteRange(o.spreadSeconds, 0, 1, "Strum spread");
  finiteRange(o.curve, 0.2, 5, "Strum curve");
  finiteRange(o.anchor, 0, 1, "Strum anchor");
  finiteRange(o.taper, 0, 0.9, "Strum taper");
  finiteRange(o.velocity, 0, 1, "Stroke velocity");
  if (
    o.stringIds &&
    (!o.stringIds.length ||
      new Set(o.stringIds).size !== o.stringIds.length ||
      o.stringIds.some((id) => !instrument.strings.some((s) => s.id === id)))
  )
    throw new RangeError("Invalid strum string mask");
  return o;
}
/** Expand an explicit rhythmic pattern; no inferred swing or random cumulative timing. */
export function expandStrumPattern(
  pattern: {
    readonly id: string;
    readonly length: Q;
    readonly strokes: readonly (StrumOptions & { readonly offset: Q })[];
  },
  repetitions: number,
  start: Q = q(0),
): StrumStroke[] {
  if (
    !pattern.id ||
    compareQ(pattern.length, q(0)) <= 0 ||
    compareQ(start, q(0)) < 0 ||
    !Number.isSafeInteger(repetitions) ||
    repetitions < 1 ||
    repetitions * pattern.strokes.length > 10000
  )
    throw new RangeError("Invalid strum pattern/budget");
  for (const s of pattern.strokes)
    if (compareQ(s.offset, q(0)) < 0 || compareQ(s.offset, pattern.length) >= 0)
      throw new RangeError("Pattern offsets must be inside its period");
  return Array.from({ length: repetitions }, (_, r) =>
    pattern.strokes.map((s, i) => {
      const { offset, ...options } = s;
      return {
        ...options,
        id: `${pattern.id}:${r}:${i}`,
        at: addQ(addQ(start, mulQ(pattern.length, q(r))), offset),
      };
    }),
  ).flat();
}
/** Compile a selected fingering to deterministic performed timings, then replay actual mechanics. */
export function createPerformance(
  arrangement: ArrangementSuccess,
  instrument: FrettedInstrument,
  options: PerformanceOptions = {},
): PerformanceResult {
  try {
    if (arrangement.status !== "success")
      throw new RangeError("A successful fretted arrangement is required");
    validateInstrument(instrument);
    const score = normalizeScore(arrangement.score),
      profile = compilePlayer({
        level: arrangement.profile.level,
        complexity: arrangement.profile.complexity,
        flexibility: arrangement.profile.flexibility,
        overrides: arrangement.profile,
      });
    const timed = options.timeLimits ?? true;
    if (typeof timed !== "boolean") throw new RangeError("timeLimits must be a boolean");
    const limits = timed ? profile : untimed(profile);
    const sourceCheck = validateFrettedArrangement(
      score,
      instrument,
      arrangement.annotations,
      { level: limits.level, overrides: limits },
    );
    if (!sourceCheck.valid)
      throw new RangeError(
        `Invalid source fingering: ${sourceCheck.diagnostics.join("; ")}`,
      );
    const max = options.maxNotes ?? 10000;
    if (!Number.isSafeInteger(max) || max < 1 || score.notes.length > max)
      throw new RangeError("Performance note budget exceeded");
    const seed = options.seed ?? "scorify",
      h = humanization(options.humanize),
      lead = options.leadInSeconds ?? 0.06;
    if (
      typeof seed !== "string" &&
      (typeof seed !== "number" || !Number.isFinite(seed))
    )
      throw new RangeError("Invalid humanization seed");
    finiteRange(lead, 0, 10, "Lead-in");
    const policy = options.timingPolicy ?? "constrain";
    if (!["constrain", "strict"].includes(policy))
      throw new RangeError("Invalid timing policy");
    const preset =
      options.preset ??
      (instrument.strings.length > 4
        ? classicalGuitarAudioPreset()
        : ukuleleAudioPreset());
    validateTone(preset.tone);
    const units = soundingNotes(score),
      byId = new Map(units.map((n) => [n.id, n])),
      index = new Map(instrument.strings.map((s, i) => [s.id, i]));
    for (const id of Object.keys(options.stringTone ?? {}))
      if (!index.has(id)) throw new RangeError(`Unknown tone string ${id}`);
    for (const id of Object.keys(options.noteTone ?? {}))
      if (!byId.has(id)) throw new RangeError(`Unknown sounding note ${id}`);
    const groups = new Map<string, SoundingNote[]>();
    for (const n of units) {
      const key = keyQ(n.onset),
        group = groups.get(key) ?? [];
      group.push(n);
      groups.set(key, group);
    }
    const explicit = new Map<string, StrumStroke>();
    const strokeIds = new Set<string>();
    for (const s of options.strokes ?? []) {
      const at = keyQ(s.at);
      if (!s.id || strokeIds.has(s.id) || explicit.has(at) || !groups.has(at))
        throw new RangeError(
          "Stroke IDs/times must be unique and refer to an actual attack",
        );
      strokeIds.add(s.id);
      explicit.set(at, s);
    }
    const base: PerformanceNote[] = [],
      strokes: PerformedStroke[] = [],
      jitter = new Map<string, number>();
    for (const [key, group] of groups) {
      const at = group[0]!.onset,
        command = explicit.get(key),
        raw = command ?? options.strum,
        hasStroke =
          raw !== false &&
          (raw !== undefined || options.strokes === undefined) &&
          group.length > 0;
      const strum = hasStroke ? strumOptions(raw || {}, instrument) : undefined,
        strokeId = command?.id ?? `strum@${key}`;
      const assignments = group.map((n) => {
        const annotation = arrangement.annotations.find((a) =>
            a.attackIds.includes(n.id),
          ),
          assignment = annotation?.assignments.find((a) => a.id === n.id);
        if (!annotation || !assignment)
          throw new RangeError(`Missing attack fingering ${n.id}`);
        return {
          n,
          assignment,
          contact:
            annotation.contacts.find((c) => c.finger === assignment.finger) ??
            null,
        };
      });
      const swept = strum
        ? assignments
            .filter(
              (a) =>
                !strum.stringIds ||
                strum.stringIds.includes(a.assignment.stringId),
            )
            .sort(
              (a, b) =>
                (index.get(a.assignment.stringId)! -
                  index.get(b.assignment.stringId)!) *
                (strum.direction === "down" ? 1 : -1),
            )
        : [];
      if (
        strum?.stringIds &&
        strum.stringIds.some(
          (id) => !swept.some((a) => a.assignment.stringId === id),
        )
      )
        throw new RangeError(
          "A strum mask may only select strings attacked at this score time",
        );
      const offsets = new Map<string, number>(),
        ratios = new Map<string, number>();
      const first = swept[0],
        last = swept.at(-1),
        distance =
          first && last
            ? Math.abs(
                index.get(last.assignment.stringId)! -
                  index.get(first.assignment.stringId)!,
              )
            : 0;
      // Without an explicit spread, the sweep follows the local tempo. (Its timing still varies through the
      // reducible stroke and string jitter below: a varied sweep speed would move a string's attack and release
      // differently in consecutive strokes, and legato chords would then overlap on that string.)
      const spread = strum
        ? (strum.spreadSeconds ??
          strumSweepSeconds(
            secondsAt(addQ(at, q(1)), score.tempoMap) -
              secondsAt(at, score.tempoMap),
            strum.direction,
            distance,
            instrument.strings.length,
          ))
        : 0;
      let minGap = Infinity,
        previous = 0;
      for (let i = 0; i < swept.length; i++) {
        const a = swept[i]!;
        const ratio = distance
            ? Math.abs(
                index.get(a.assignment.stringId)! -
                  index.get(first!.assignment.stringId)!,
              ) / distance
            : 0,
          // The anchored part of the sweep lands on the beat: early strings before it, late strings after it.
          offset = distance ? spread * (ratio ** strum!.curve - strum!.anchor) : 0;
        offsets.set(a.n.id, offset);
        ratios.set(a.n.id, ratio);
        if (i) minGap = Math.min(minGap, offset - previous);
        previous = offset;
      }
      if (swept.length)
        strokes.push({
          id: strokeId,
          at,
          direction: strum!.direction,
          noteIds: swept.map((a) => a.n.id),
          spreadSeconds: spread,
          curve: strum!.curve,
          anchor: strum!.anchor,
          taper: strum!.taper,
        });
      const sharedId = hasStroke ? strokeId : `onset@${key}`,
        shared =
          ((h.amount * h.timingMs) / 1000) *
          signedRandom(seed, sharedId, "timing");
      for (const { n, assignment, contact } of assignments) {
        const inStroke = offsets.has(n.id),
          nominalOnsetSeconds = lead + secondsAt(n.onset, score.tempoMap),
          nominalEndSeconds = lead + secondsAt(n.end, score.tempoMap),
          offset = offsets.get(n.id) ?? 0;
        const onsetLocked = n.notes.some((n) => n.locked?.onset);
        // An onset lock also prevents a strum from moving that exact attack.
        if (onsetLocked && offset !== 0)
          throw new RangeError(`Strum conflicts with onset lock on ${n.id}`);
        if (nominalOnsetSeconds + offset < 0)
          throw new RangeError(
            `The lead-in is shorter than the early strings of the strum at ${n.id}`,
          );
        const independentLimit =
          inStroke && swept.length > 1
            ? Math.min(h.stringTimingMs / 1000, minGap * 0.2)
            : h.stringTimingMs / 1000;
        const delta = onsetLocked
          ? 0
          : shared +
            h.amount *
              independentLimit *
              signedRandom(seed, n.id, "string-timing");
        jitter.set(n.id, delta);
        const tone = {
          ...preset.tone,
          ...options.tone,
          ...options.stringTone?.[assignment.stringId],
          ...options.noteTone?.[n.id],
        };
        validateTone(tone);
        const commonVelocity = signedRandom(seed, sharedId, "velocity"),
          vary = (channel: string) => signedRandom(seed, n.id, channel);
        // Played dynamics, not noise: the bar's strong beats, melody and thumb (bass) over inner notes, and in a
        // strum the first string struck hardest, unless it carries the melody, which stays on top.
        const depth = h.amount * h.dynamics,
          role = n.notes[0]?.role,
          dominant = role === "melody",
          accent =
            0.15 * metricWeight(n.onset, score.meterMap) +
            (dominant
              ? 0.15
              : role === "bass"
                ? 0.08
                : inStroke
                  ? 0
                  : role === "harmony"
                    ? -0.06
                    : 0),
          taper =
            inStroke && !dominant
              ? 1 - depth * strum!.taper * ratios.get(n.id)!
              : 1,
          nominalVelocity = tone.velocity * (inStroke ? strum!.velocity : 1);
        const velocity = bounded(
          nominalVelocity *
            taper *
            (1 + depth * accent) *
            (1 +
              h.amount *
                h.velocity *
                (0.7 * commonVelocity + 0.3 * vary("velocity"))),
          0,
          1,
        );
        base.push({
          id: n.id,
          noteIds: [...n.noteIds],
          stringId: assignment.stringId,
          frequency:
            score.concertAHz *
            2 ** ((pitchToMidi(pitchString(n.pitch)) - 69) / 12),
          nominalOnsetSeconds,
          nominalEndSeconds,
          onsetSeconds: nominalOnsetSeconds + offset,
          endSeconds: nominalEndSeconds + offset,
          offsetSeconds: offset,
          assignment: { ...assignment, noteIds: [...assignment.noteIds] },
          contact: contact ? { ...contact } : null,
          strokeId: inStroke ? strokeId : null,
          excitationSeed: seedHash(seed, n.id, "excitation"),
          velocity,
          // A harder pluck is louder (velocity scales the excitation) and brighter.
          brightness: bounded(
            tone.brightness +
              0.8 * (velocity - nominalVelocity) +
              h.amount * h.brightness * vary("brightness"),
            0,
            1,
          ),
          detuneCents: driftCents(
            seed,
            assignment.stringId,
            nominalOnsetSeconds,
            h.amount * h.driftCents,
          ),
          pluckPosition: bounded(
            tone.pluckPosition + h.amount * h.pluckPosition * vary("position"),
            0.02,
            0.98,
          ),
          decaySeconds: bounded(
            tone.decaySeconds * (1 + h.amount * h.decay * vary("decay")),
            0.02,
            30,
          ),
          muted: tone.muted || (inStroke && strum!.muted),
        });
      }
    }
    let diagnostics: readonly string[] = [];
    const scales = policy === "strict" ? [1] : [1, 0.5, 0.25, 0.125, 0.0625, 0];
    for (const scale of scales) {
      const events = base
        .map((e) => {
          const delta = (jitter.get(e.id) ?? 0) * scale;
          return {
            ...e,
            onsetSeconds: e.onsetSeconds + delta,
            endSeconds: e.endSeconds + delta,
            offsetSeconds: e.offsetSeconds + delta,
          };
        })
        .sort(
          (a, b) => a.onsetSeconds - b.onsetSeconds || a.id.localeCompare(b.id),
        );
      const durationSeconds = Math.max(
        lead + notatedDurationSeconds(score),
        ...events.map((e) => e.endSeconds),
      );
      const plan: PerformancePlan = {
        schemaVersion: 1,
        version: "scorify-performance-1",
        score,
        instrument: JSON.parse(JSON.stringify(instrument)) as FrettedInstrument,
        profile,
        annotations: JSON.parse(
          JSON.stringify(arrangement.annotations),
        ) as FrettedAnnotation[],
        strings: instrument.strings.map((s) => s.id),
        events,
        strokes,
        seed,
        leadInSeconds: lead,
        preset: JSON.parse(JSON.stringify(preset)) as AudioPreset,
        durationSeconds,
        humanization: { requested: h, timingScale: scale },
        diagnostics: [
          ...(scale < 1 ? [`Timing humanization reduced to ${scale} of requested offsets to preserve playability`] : []),
          ...(timed ? [] : ["Time-based player limits (attacks per second, shift and finger speed, finger setup) were not checked at this tempo"]),
        ],
        constraints: { valid: true, model: "scorify-performed-fretted-1" },
        ...(timed ? {} : { timeLimits: "lifted" as const }),
      };
      const check = validatePerformance(plan);
      if (check.valid) return { status: "success", performance: plan };
      diagnostics = check.diagnostics;
    }
    return {
      status: "unplayable",
      diagnostics: [
        ...diagnostics,
        "Selected fingering cannot realize these performance timings; choose a smaller strum, explicit gates, or a different arrangement.",
      ],
    };
  } catch (error) {
    return {
      status: "invalid-input",
      diagnostics: [error instanceof Error ? error.message : String(error)],
    };
  }
}
/** Reconstruct contact state at actual (not nominal) attack/release times. */
export function validatePerformance(plan: PerformancePlan): {
  readonly valid: boolean;
  readonly diagnostics: readonly string[];
} {
  const errors: string[] = [];
  try {
    if (plan.schemaVersion !== 1 || plan.version !== "scorify-performance-1")
      throw new RangeError("Invalid performance schema");
    const score = normalizeScore(plan.score);
    validateInstrument(plan.instrument);
    const h = humanization(plan.humanization.requested);
    finiteRange(plan.humanization.timingScale, 0, 1, "Timing scale");
    validateTone(plan.preset.tone);
    if (
      typeof plan.seed !== "string" &&
      (typeof plan.seed !== "number" || !Number.isFinite(plan.seed))
    )
      throw new RangeError("Invalid seed");
    if (plan.timeLimits !== undefined && plan.timeLimits !== "lifted")
      throw new RangeError("Invalid time limits");
    const player = compilePlayer({
        level: plan.profile.level,
        complexity: plan.profile.complexity,
        flexibility: plan.profile.flexibility,
        overrides: plan.profile,
      }),
      p = plan.timeLimits === "lifted" ? untimed(player) : player;
    const nominal = validateFrettedArrangement(
      score,
      plan.instrument,
      plan.annotations,
      { level: p.level, overrides: p },
    );
    if (!nominal.valid) errors.push(...nominal.diagnostics);
    const units = soundingNotes(score),
      unitById = new Map(units.map((n) => [n.id, n])),
      byId = new Map<string, PerformanceNote>();
    finiteRange(plan.leadInSeconds, 0, 10, "Lead-in");
    finiteRange(plan.durationSeconds, 0, 86400, "Duration");
    if (
      plan.durationSeconds + 1e-8 <
      plan.leadInSeconds + notatedDurationSeconds(score)
    )
      errors.push("Performance truncates notated duration/rests");
    if (
      plan.events.length !== units.length ||
      JSON.stringify(plan.strings) !==
        JSON.stringify(plan.instrument.strings.map((s) => s.id))
    )
      errors.push("Performance note/string multiplicity mismatch");
    const times = new Set<number>();
    for (const e of plan.events) {
      const n = unitById.get(e.id);
      if (!n || byId.has(e.id)) {
        errors.push("Unknown/duplicate sounding event");
        continue;
      }
      byId.set(e.id, e);
      validateTone(e);
      finiteRange(e.onsetSeconds, 0, plan.durationSeconds, "Onset");
      finiteRange(
        e.endSeconds,
        e.onsetSeconds + 1e-9,
        plan.durationSeconds,
        "Release",
      );
      const onset = plan.leadInSeconds + secondsAt(n.onset, score.tempoMap),
        end = plan.leadInSeconds + secondsAt(n.end, score.tempoMap);
      finiteRange(e.nominalOnsetSeconds, 0, 86400, "Nominal onset");
      finiteRange(e.nominalEndSeconds, 0, 86400, "Nominal end");
      finiteRange(e.offsetSeconds, -1, 2, "Timing offset");
      if (e.excitationSeed !== seedHash(plan.seed, e.id, "excitation"))
        errors.push("Excitation seed provenance mismatch");
      if (
        Math.abs(e.nominalOnsetSeconds - onset) > 1e-8 ||
        Math.abs(e.nominalEndSeconds - end) > 1e-8 ||
        Math.abs(e.endSeconds - e.onsetSeconds - (end - onset)) > 1e-8 ||
        Math.abs(e.offsetSeconds - (e.onsetSeconds - onset)) > 1e-8
      )
        errors.push("Nominal timing/duration provenance mismatch");
      if (
        n.notes.some((n) => n.locked?.onset) &&
        Math.abs(e.onsetSeconds - onset) > 1e-8
      )
        errors.push("Onset lock violated");
      const frequency =
        score.concertAHz * 2 ** ((pitchToMidi(pitchString(n.pitch)) - 69) / 12);
      if (
        !Number.isFinite(e.frequency) ||
        Math.abs(e.frequency - frequency) > 1e-7
      )
        errors.push("Pitch/tuning changed");
      // Drift is a separate, sub-cent detune; the written frequency above stays exact.
      const detune = e.detuneCents ?? 0;
      if (
        !Number.isFinite(detune) ||
        Math.abs(detune) > Math.min(0.99, h.amount * h.driftCents) + 1e-9
      )
        errors.push("Pitch drift exceeds declared humanization");
      const a = plan.annotations.find((a) => a.attackIds.includes(e.id)),
        assignment = a?.assignments.find((n) => n.id === e.id),
        contact =
          a?.contacts.find((c) => c.finger === e.assignment.finger) ?? null;
      if (
        JSON.stringify(e.assignment) !== JSON.stringify(assignment) ||
        JSON.stringify(e.contact) !== JSON.stringify(contact) ||
        e.stringId !== e.assignment.stringId ||
        JSON.stringify(e.noteIds) !== JSON.stringify(n.noteIds)
      )
        errors.push("Fingering provenance mismatch");
      times.add(e.onsetSeconds);
      times.add(e.endSeconds);
    }
    if (errors.length)
      return { valid: false, diagnostics: [...new Set(errors)] };
    const strokeIds = new Set<string>(),
      sweptIds = new Set<string>();
    for (const stroke of plan.strokes) {
      strumOptions(stroke, plan.instrument);
      if (!stroke.id || strokeIds.has(stroke.id))
        throw new RangeError("Invalid/duplicate stroke ID");
      strokeIds.add(stroke.id);
      for (const id of stroke.noteIds) {
        if (
          sweptIds.has(id) ||
          keyQ(unitById.get(id)!.onset) !== keyQ(stroke.at)
        )
          throw new RangeError("Invalid stroke attack provenance");
        sweptIds.add(id);
      }
      const selected = stroke.noteIds.map((id) => byId.get(id));
      if (
        !selected.length ||
        selected.some((e) => !e || e.strokeId !== stroke.id)
      )
        throw new RangeError("Invalid stroke membership");
      let previous = -Infinity;
      const indices = selected.map((e) =>
        plan.instrument.strings.findIndex((s) => s.id === e!.stringId),
      );
      for (let i = 0; i < selected.length; i++) {
        const e = selected[i]!;
        if (
          e.onsetSeconds < previous - 1e-9 ||
          (i &&
            (indices[i]! - indices[i - 1]!) *
              (stroke.direction === "down" ? 1 : -1) <=
              0)
        )
          errors.push("Strum order changed");
        previous = e.onsetSeconds;
      }
      const first = selected[0]!,
        last = selected.at(-1)!,
        min = Math.min(...indices),
        max = Math.max(...indices);
      const allowance =
        ((h.amount * (h.timingMs + h.stringTimingMs)) / 1000) *
        plan.humanization.timingScale;
      for (let i = 0; i < selected.length; i++) {
        const distance = max - min,
          ratio = distance ? Math.abs(indices[i]! - indices[0]!) / distance : 0;
        const expected = distance
          ? stroke.spreadSeconds * (ratio ** stroke.curve - (stroke.anchor ?? 0))
          : 0;
        if (Math.abs(selected[i]!.offsetSeconds - expected) > allowance + 1e-8)
          errors.push("Strum offset exceeds declared humanization");
      }
      for (let i = min; i <= max; i++) {
        if (indices.includes(i)) continue;
        const fraction =
            max === min
              ? 0
              : (stroke.direction === "down" ? i - min : max - i) / (max - min),
          cross =
            first.onsetSeconds +
            (last.onsetSeconds - first.onsetSeconds) * fraction ** stroke.curve,
          stringId = plan.instrument.strings[i]!.id;
        if (!p.allowMutedStrum)
          errors.push(
            "Strum crosses an unintended string without muting capability",
          );
        if (
          plan.events.some(
            (e) =>
              e.stringId === stringId &&
              e.onsetSeconds <= cross + allowance &&
              e.endSeconds > cross - allowance,
          )
        )
          errors.push("Strum would reattack/mute an unrequested held string");
      }
    }
    for (const e of plan.events) {
      if (e.strokeId !== null && !sweptIds.has(e.id))
        errors.push("Missing stroke membership");
      if (
        e.strokeId === null &&
        Math.abs(e.offsetSeconds) >
          ((h.amount * (h.timingMs + h.stringTimingMs)) / 1000) *
            plan.humanization.timingScale +
            1e-8
      )
        errors.push("Pluck offset exceeds declared humanization");
    }
    const adapter = createFrettedAdapter(plan.instrument),
      context = {
        player: { ...p, rightHand: "pick" as const },
        tick: () => {},
      };
    let state = adapter.initialState(),
      previous: FrettedRealization | undefined;
    const attackTimes: number[] = [];
    for (const seconds of [...times].sort((a, b) => a - b)) {
      const active = plan.events.filter(
          (e) => e.onsetSeconds <= seconds && e.endSeconds > seconds,
        ),
        attacks = active.filter((e) => e.onsetSeconds === seconds);
      const contacts: FingerContact[] = [];
      for (let finger = 1; finger <= 4; finger++) {
        const assigned = active.filter((e) => e.assignment.finger === finger);
        if (!assigned.length) continue;
        const held = previous?.assignments.some(
          (a) =>
            a.finger === finger &&
            active.some((e) => e.id === a.id) &&
            !attacks.some((e) => e.id === a.id),
        );
        const contact = held
          ? previous!.contacts.find((c) => c.finger === finger)
          : assigned[0]!.contact;
        if (contact) contacts.push(contact);
      }
      const realization = realizeFrettedAssignments(
          active.map((e) => e.assignment),
          plan.instrument,
          contacts,
        ),
        logical = quartersAtSeconds(
          Math.max(0, seconds - plan.leadInSeconds),
          score.tempoMap,
        ),
        frame = {
          at: q(Math.round(logical * 1000000), 1000000),
          seconds,
          active: active.map((e) => unitById.get(e.id)!),
          attackIds: attacks.map((e) => e.id),
        };
      if (
        active.length > p.maxPolyphony ||
        new Set(frame.active.map((n) => JSON.stringify([n.partId, n.voiceId])))
          .size > p.maxVoices
      )
        errors.push("Performed polyphony/voice limit");
      attackTimes.push(...attacks.map(() => seconds));
      if (
        attackTimes.filter((t) => t > seconds - 1 + 1e-9).length >
        p.maxAttacksPerSecond
      )
        errors.push("Performed attack density limit");
      errors.push(...adapter.validateState(realization, frame, context));
      const transition = adapter.transition(
        state,
        previous,
        realization,
        frame,
        context,
      );
      if (!transition.valid) errors.push(...transition.diagnostics);
      state = transition.state;
      previous = realization;
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return { valid: errors.length === 0, diagnostics: [...new Set(errors)] };
}
