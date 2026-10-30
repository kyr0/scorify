import { validateScore, normalizeScore, soundingNotes, barAt } from "./model.js";
import {
  q,
  compareQ,
  keyQ,
  subQ,
  secondsAt,
  numberQ,
  addQ,
  isMultipleQ,
} from "./time.js";
import { compilePlayer, compileAdaptation } from "./profiles.js";
import { transformScore } from "./transforms.js";
import { analyzeHarmony } from "./analysis.js";
import { validateInstrument } from "./fretted.js";
import { createFrettedAdapter } from "./fingering.js";
import { validateFrettedArrangement } from "./validate.js";
import { variantsFor, outputNotes } from "./internal/variants.js";
import type { Variant } from "./internal/variants.js";
import type { Score, Edit, HarmonySpan, SoundingNote } from "./model.js";
import type { Q } from "./time.js";
import type {
  PlayerOptions,
  PlayerProfile,
  AdaptationPolicy,
} from "./profiles.js";
import type { TransformOptions } from "./transforms.js";
import type { FrettedInstrument } from "./fretted.js";
import type {
  FrettedAnnotation,
  FrettedRealization,
  FrettedState,
} from "./fingering.js";
import type {
  InstrumentAdapter,
  AdapterFrame,
  MechanicsContext,
} from "./adapters.js";
export interface SearchOptions {
  readonly strategy?: "beam" | "exact" | "exhaustive";
  readonly beamWidth?: number;
  readonly maxCandidatesPerFrame?: number;
  readonly maxExpandedStates?: number;
  readonly maxFrames?: number;
  readonly maxInputNotes?: number;
  readonly maxInputEvents?: number;
}
export interface Cancellation {
  readonly aborted: boolean;
}
export interface SearchProgress {
  readonly frame: number;
  readonly frames: number;
  readonly expandedStates: number;
  readonly frontier: number;
}
export interface CostBreakdown {
  readonly musicalLoss: number;
  readonly ergonomicCost: number;
  readonly transitionCost: number;
  readonly styleCost: number;
  readonly total: number;
}
export interface SearchStats {
  readonly strategy: string;
  readonly frames: number;
  readonly expandedStates: number;
  readonly discardedCandidates: number;
  readonly dominatedStates: number;
  readonly exhaustive: boolean;
}
export interface ArrangementOptions {
  readonly instrument?: FrettedInstrument;
  readonly mode?: "unconstrained" | "exact" | "adaptive";
  readonly transform?: TransformOptions;
  readonly player?: PlayerOptions;
  readonly adaptation?: Partial<AdaptationPolicy>;
  readonly search?: SearchOptions;
  readonly autoTempo?: boolean;
  readonly signal?: Cancellation;
  readonly scoring?: {
    readonly id: string;
    readonly cost: (frame: AdapterFrame, realization: unknown) => number;
  };
}
export interface DifficultyReport {
  readonly maxPolyphony: number;
  readonly maxVoices: number;
  readonly maxAttacksInOneSecond: number;
  /** The most notes one bar starts while the right hand picks (0 when it strums). */
  readonly maxPickedInOneBar: number;
  readonly ornamentRetention: number;
  readonly maxFretSpan: number | null;
  readonly maxReachMm: number | null;
  readonly maxShiftFrets: number | null;
  readonly model: string;
  readonly calibrated: false;
}
export interface ArrangementSuccess<Annotation = FrettedAnnotation> {
  readonly status: "success";
  readonly score: Score;
  readonly annotations: readonly Annotation[];
  readonly sourceHarmony: readonly HarmonySpan[];
  readonly realizedHarmony: readonly HarmonySpan[];
  readonly edits: readonly Edit[];
  readonly cost: CostBreakdown;
  readonly difficulty: DifficultyReport;
  readonly profile: PlayerProfile;
  readonly optimality: "proven-in-model" | "best-found";
  readonly stats: SearchStats;
  readonly assumptions: readonly string[];
  readonly sourceMap: Readonly<Record<string, readonly string[]>>;
  readonly modelVersions: {
    readonly score: 1;
    readonly adapter: string;
    readonly policy: string;
    readonly scoring: string;
  };
  readonly constraints: { readonly valid: true; readonly model: string };
}
export interface ArrangementFailure {
  readonly status:
    | "infeasible"
    | "search-exhausted"
    | "unsupported"
    | "invalid-input"
    | "cancelled";
  readonly diagnostics: readonly string[];
  readonly stats: SearchStats;
}
export type ArrangementResult<Annotation = FrettedAnnotation> =
  | ArrangementSuccess<Annotation>
  | ArrangementFailure;
class Stop extends Error {
  constructor(readonly reason: "budget" | "cancelled") {
    super(reason);
  }
}
function total(c: Omit<CostBreakdown, "total">): CostBreakdown {
  return {
    ...c,
    total: c.musicalLoss + c.ergonomicCost + c.transitionCost + c.styleCost,
  };
}
/** A persistent list, newest first: paths share what they have in common instead of each copying it. */
type Trail<T> = { readonly item: T; readonly rest: Trail<T> } | undefined;
const trailArray = <T>(trail: Trail<T>): T[] => {
  const items: T[] = [];
  for (let t = trail; t; t = t.rest) items.push(t.item);
  return items.reverse();
};
interface Path<State, Realization, Annotation> {
  /** Every variant chosen so far, and (in the order chosen) those whose note has not ended at the current frame. */
  chosen: Trail<Variant>;
  sounding: Variant[];
  state: State;
  realization: Realization | undefined;
  history: Trail<{ frame: AdapterFrame; realization: Realization }>;
  annotations: Trail<Annotation>;
  cost: CostBreakdown;
  ornaments: number;
  omissions: number;
  attacks: number[];
  maxAttacks: number;
  /** Notes picked so far in the current frame's bar, at how many moments, and the most in any bar. */
  picked: number;
  pickedAt: number;
  maxPicked: number;
  /** A lower bound of the loss still to come in this bar: moments it must leave empty to stay within the picking limit. */
  outlook: number;
  maxPolyphony: number;
  maxVoices: number;
  maxShift: number;
  serial: number;
}
/** The musical loss of leaving a moment of the source without any of its (non-ornament) notes. */
const EMPTIED_MOMENT = 24;
/** Generic search engine; adapters can model future keyboards without fretted fields. */
export function* arrangeSteps<State, Realization, Annotation>(
  source: Score,
  options: ArrangementOptions,
  adapter?: InstrumentAdapter<State, Realization, Annotation>,
): Generator<SearchProgress, ArrangementResult<Annotation>, void> {
  const strategy = options.search?.strategy ?? "beam";
  let expanded = 0,
    discarded = 0,
    dominated = 0,
    frameIndex = 0,
    frameCount = 0,
    truncated = false;
  const stats = (): SearchStats => ({
    strategy,
    frames: frameCount,
    expandedStates: expanded,
    discardedCandidates: discarded,
    dominatedStates: dominated,
    exhaustive: !truncated,
  });
  const failure = (
    status: ArrangementFailure["status"],
    diagnostics: string[],
  ): ArrangementFailure => ({ status, diagnostics, stats: stats() });
  try {
    const search = {
      beamWidth: options.search?.beamWidth ?? 64,
      maxCandidatesPerFrame:
        options.search?.maxCandidatesPerFrame ??
        (strategy === "beam" ? 128 : Number.MAX_SAFE_INTEGER),
      maxExpandedStates: options.search?.maxExpandedStates ?? 500000,
      maxFrames: options.search?.maxFrames ?? 10000,
      maxInputNotes: options.search?.maxInputNotes ?? 10000,
      maxInputEvents: options.search?.maxInputEvents ?? 20000,
    };
    if (
      !["beam", "exact", "exhaustive"].includes(strategy) ||
      Object.values(search).some((n) => !Number.isSafeInteger(n) || n < 1)
    )
      return failure("invalid-input", ["Invalid search policy"]);
    if (options.signal?.aborted)
      return failure("cancelled", ["Cancelled before search"]);
    const mode = options.mode ?? "exact";
    if (!["unconstrained", "exact", "adaptive"].includes(mode))
      return failure("invalid-input", ["Invalid arrangement mode"]);
    if (source?.notes?.length > search.maxInputNotes) {
      truncated = true;
      return failure("search-exhausted", ["Input note budget exceeded"]);
    }
    const inputEvents = [
      source?.notes,
      source?.rests,
      source?.tempoMap,
      source?.meterMap,
      source?.keyMap,
      source?.harmony,
    ].reduce(
      (count, events) => count + (Array.isArray(events) ? events.length : 0),
      0,
    );
    if (inputEvents > search.maxInputEvents) {
      truncated = true;
      return failure("search-exhausted", ["Input event budget exceeded"]);
    }
    const base = normalizeScore(source),
      profile = compilePlayer(options.player);
    if (
      options.autoTempo !== undefined &&
      typeof options.autoTempo !== "boolean"
    )
      return failure("invalid-input", ["autoTempo must be boolean"]);
    if (
      options.autoTempo &&
      (options.transform?.tempoScale !== undefined ||
        options.transform?.quarterBpm !== undefined)
    )
      return failure("invalid-input", [
        "autoTempo cannot override an explicit tempo request",
      ]);
    const transform = options.autoTempo
      ? {
          ...options.transform,
          tempoScale: Math.min(
            1,
            profile.suggestedQuarterBpm /
              Math.max(...base.tempoMap.map((t) => t.quarterBpm)),
          ),
        }
      : options.transform;
    const transformed = transformScore(base, transform),
      score = transformed.score,
      adaptation = compileAdaptation(options.adaptation, profile.level);
    if (
      options.scoring &&
      (!options.scoring.id || typeof options.scoring.cost !== "function")
    )
      return failure("invalid-input", [
        "Scoring hook needs a stable ID and function",
      ]);
    if (
      adaptation.protectedNoteIds.some(
        (id) => !score.notes.some((n) => n.id === id),
      )
    )
      return failure("invalid-input", ["Unknown protected note ID"]);
    if (options.autoTempo)
      transformed.edits.splice(
        0,
        transformed.edits.length,
        ...transformed.edits.map((e) =>
          e.kind === "tempo"
            ? {
                ...e,
                permission: "autoTempo",
                reason: "Explicitly requested level tempo ceiling",
              }
            : e,
        ),
      );
    const sourceHarmony = analyzeHarmony(score);
    const units = soundingNotes(score),
      ornamentCount = units.filter((u) =>
        u.notes.every((n) => n.role === "ornament"),
      ).length;
    const assumptions = [
      "Level thresholds are editable, uncalibrated policies.",
      "Sounding durations follow explicit gates; otherwise full notation.",
      "Exactness/optimality is relative to the finite candidate and mechanics model.",
    ];
    function result(
      best: Path<State, Realization, Annotation> | undefined,
      unconstrained = false,
    ): ArrangementSuccess<Annotation> {
      const chosen = trailArray(best?.chosen),
        annotations = trailArray(best?.annotations),
        notes = unconstrained ? score.notes : outputNotes(chosen),
        edits = [...transformed.edits, ...chosen.flatMap((c) => c.edits)];
      const noteIds = new Set(notes.map((n) => n.id));
      const restConflicts = score.rests.filter((r) =>
        notes.some(
          (n) =>
            n.partId === r.partId &&
            n.voiceId === r.voiceId &&
            compareQ(r.onset, addQ(n.onset, n.duration)) < 0 &&
            compareQ(n.onset, addQ(r.onset, r.duration)) < 0,
        ),
      );
      if (restConflicts.length)
        throw new RangeError(
          "Selected rhythm edit conflicts with an explicit rest",
        );
      // Source intent remains a separate layer. Inferred annotations are recomputed from the rendition.
      const provided = score.harmony
        .filter((h) => h.provenance === "provided")
        .map((h) => ({
          ...h,
          evidenceNoteIds: h.evidenceNoteIds.filter((id) => noteIds.has(id)),
        }));
      const output = normalizeScore({
        ...score,
        notes,
        harmony: unconstrained ? score.harmony : provided,
      });
      const realizedHarmony = analyzeHarmony(output, {
        respectProvided: false,
      });
      if (
        !unconstrained &&
        score.harmony.some((h) => h.provenance === "inferred")
      )
        edits.push({
          kind: "harmony-invalidated",
          sourceIds: [],
          outputIds: [],
          before: score.harmony.filter((h) => h.provenance === "inferred"),
          after: realizedHarmony,
          reason: "Recomputed from realized notes",
          permission: "derived-annotation-recompute",
        });
      let observedPoly = 0,
        observedVoices = 0,
        observedAttacks = 0,
        observedPicked = 0;
      if (unconstrained) {
        if (profile.rightHand === "pick") {
          const perBar = new Map<number, number>();
          for (const u of units) perBar.set(barAt(u.onset, score.meterMap), (perBar.get(barAt(u.onset, score.meterMap)) ?? 0) + 1);
          observedPicked = Math.max(0, ...perBar.values());
        }
        for (const u of units) {
          const active = units.filter(
            (n) =>
              compareQ(n.onset, u.onset) <= 0 && compareQ(n.end, u.onset) > 0,
          );
          observedPoly = Math.max(observedPoly, active.length);
          observedVoices = Math.max(
            observedVoices,
            new Set(active.map((n) => JSON.stringify([n.partId, n.voiceId])))
              .size,
          );
          const t = secondsAt(u.onset, score.tempoMap);
          observedAttacks = Math.max(
            observedAttacks,
            units.filter((n) => {
              const s = secondsAt(n.onset, score.tempoMap);
              return s <= t && s > t - 1 + 1e-9;
            }).length,
          );
        }
      }
      const sourceMap: Record<string, readonly string[]> = Object.create(
        null,
      ) as Record<string, readonly string[]>;
      for (const n of base.notes)
        sourceMap[n.id] = notes
          .filter((out) => out.id === n.id)
          .map((out) => out.id);
      return {
        status: "success",
        score: output,
        annotations,
        sourceHarmony,
        realizedHarmony,
        edits,
        cost:
          best?.cost ??
          total({
            musicalLoss: 0,
            ergonomicCost: 0,
            transitionCost: 0,
            styleCost: 0,
          }),
        difficulty: {
          maxPolyphony: best?.maxPolyphony ?? observedPoly,
          maxVoices: best?.maxVoices ?? observedVoices,
          maxAttacksInOneSecond: best?.maxAttacks ?? observedAttacks,
          maxPickedInOneBar: best?.maxPicked ?? observedPicked,
          ornamentRetention: ornamentCount
            ? (best?.ornaments ?? ornamentCount) / ornamentCount
            : 0,
          maxFretSpan:
            adapter?.kind === "fretted"
              ? Math.max(
                  0,
                  ...annotations.map(
                    (a) => (a as unknown as FrettedAnnotation).spanFrets,
                  ),
                )
              : null,
          maxReachMm:
            adapter?.kind === "fretted" &&
            annotations.some(
              (a) => (a as unknown as FrettedAnnotation).reachMm !== null,
            )
              ? Math.max(
                  0,
                  ...annotations.map(
                    (a) => (a as unknown as FrettedAnnotation).reachMm ?? 0,
                  ),
                )
              : null,
          maxShiftFrets:
            adapter?.kind === "fretted" ? (best?.maxShift ?? 0) : null,
          model: unconstrained ? "unconstrained" : adapter!.version,
          calibrated: false,
        },
        profile,
        optimality: truncated ? "best-found" : "proven-in-model",
        stats: stats(),
        assumptions,
        sourceMap,
        modelVersions: {
          score: 1,
          adapter: unconstrained ? "none" : adapter!.version,
          policy: profile.version,
          scoring: options.scoring?.id ?? "scorify-cost-1",
        },
        constraints: {
          valid: true,
          model: unconstrained ? "symbolic" : adapter!.version,
        },
      };
    }
    if (mode === "unconstrained") return result(undefined, true);
    if (!adapter)
      return failure("invalid-input", [
        "Constrained mode requires an instrument or adapter",
      ]);
    const unsupported = score.notes.filter((n) =>
      n.techniques?.some((t) => t !== "ordinary"),
    );
    if (unsupported.length)
      return failure("unsupported", [
        `Unsupported techniques on ${unsupported.map((n) => n.id).join(", ")}`,
      ]);
    if (options.instrument) {
      validateInstrument(options.instrument);
      if (
        (profile.maxReachMm !== undefined ||
          profile.maxFingerSpeedMmPerSecond !== undefined ||
          profile.fingerPairMaxMm !== undefined) &&
        (!options.instrument.scaleLengthMm ||
          !options.instrument.stringSpacingMm)
      )
        return failure("invalid-input", [
          "Hard millimetre limits require scaleLengthMm and stringSpacingMm",
        ]);
    }
    assumptions.push(
      `Mechanics: ${adapter.version}. Fretted adapter uses four ordered fingers and fixed barre footprints while held.`,
    );
    const ornamentBudget =
      mode === "adaptive"
        ? Math.floor(ornamentCount * profile.complexity + 1e-9)
        : ornamentCount;
    const variants = new Map<string, Variant[]>();
    const times = new Map<string, Q>([[keyQ(q(0)), q(0)]]);
    for (const unit of units) {
      const choices = variantsFor(
        unit,
        mode === "adaptive",
        adaptation,
        profile,
      ).filter(
        (v) =>
          !v.note ||
          !score.rests.some((r) =>
            v.note!.notes.some(
              (n) =>
                n.partId === r.partId &&
                n.voiceId === r.voiceId &&
                compareQ(r.onset, addQ(n.onset, n.duration)) < 0 &&
                compareQ(n.onset, addQ(r.onset, r.duration)) < 0,
            ),
          ),
      );
      variants.set(unit.id, choices);
      times.set(keyQ(unit.onset), unit.onset);
      for (const v of choices)
        if (v.note)
          for (const t of [v.note.onset, v.note.end]) times.set(keyQ(t), t);
    }
    let end = q(0);
    for (const t of times.values()) if (compareQ(t, end) > 0) end = t;
    for (const tempo of score.tempoMap)
      if (compareQ(tempo.at, end) < 0) times.set(keyQ(tempo.at), tempo.at);
    const ordered = [...times.values()].sort(compareQ);
    // With a picked-notes-per-bar limit, the notes that must sound (no omission allowed) still to start in a bar are
    // reserved: a path that spends the bar's picks on accompaniment first is pruned at once instead of at the melody.
    const mandatory = new Map<number, Q[]>(),
      moments = new Map<number, Q[]>(),
      optional = new Set([...variants].filter(([, choices]) => choices.some((v) => !v.note)).map(([id]) => id));
    for (const u of units)
      if (u.notes.some((n) => n.role !== "ornament")) {
        const bar = barAt(u.onset, score.meterMap),
          list = moments.get(bar) ?? [];
        if (!list.some((t) => compareQ(t, u.onset) === 0)) moments.set(bar, [...list, u.onset]);
      }
    if (profile.rightHand === "pick" && profile.maxPickedPerBar !== undefined)
      for (const choices of variants.values()) {
        if (!choices.length || choices.some((v) => !v.note)) continue;
        const onsets = choices.map((v) => v.note!.onset),
          bar = barAt(onsets[0]!, score.meterMap);
        if (onsets.every((o) => barAt(o, score.meterMap) === bar))
          mandatory.set(bar, [...(mandatory.get(bar) ?? []), onsets.reduce((a, b) => (compareQ(a, b) <= 0 ? a : b))]);
      }
    frameCount = ordered.length;
    if (frameCount > search.maxFrames) {
      truncated = true;
      return failure("search-exhausted", ["Frame budget exceeded"]);
    }
    const tick = () => {
      if (options.signal?.aborted) throw new Stop("cancelled");
      if (++expanded > search.maxExpandedStates) throw new Stop("budget");
    };
    const context: MechanicsContext = { player: profile, tick };
    let serial = 0;
    let frontier: Path<State, Realization, Annotation>[] = [
      {
        chosen: undefined,
        sounding: [],
        state: adapter.initialState(),
        realization: undefined,
        history: undefined,
        annotations: undefined,
        cost: total({
          musicalLoss: 0,
          ergonomicCost: 0,
          transitionCost: 0,
          styleCost: 0,
        }),
        ornaments: 0,
        omissions: 0,
        attacks: [],
        maxAttacks: 0,
        picked: 0,
        pickedAt: 0,
        maxPicked: 0,
        outlook: 0,
        maxPolyphony: 0,
        maxVoices: 0,
        maxShift: 0,
        serial: serial++,
      },
    ];
    // Yields each choice of variants for the notes starting at a frame: the path with its costs, and the choice.
    function* choose(
      path: Path<State, Realization, Annotation>,
      starting: readonly SoundingNote[],
      i = 0,
      picks: readonly Variant[] = [],
    ): Generator<[Path<State, Realization, Annotation>, readonly Variant[]]> {
      if (i === starting.length) {
        yield [path, picks];
        return;
      }
      for (const v of variants.get(starting[i]!.id)!) {
        tick();
        if (
          path.ornaments + v.ornament > ornamentBudget ||
          path.omissions + v.omitted > adaptation.maxOmissions
        )
          continue;
        yield* choose(
          {
            ...path,
            ornaments: path.ornaments + v.ornament,
            omissions: path.omissions + v.omitted,
            cost: total({
              ...path.cost,
              musicalLoss: path.cost.musicalLoss + v.loss,
            }),
          },
          starting,
          i + 1,
          [...picks, v],
        );
      }
    }
    for (frameIndex = 0; frameIndex < ordered.length; frameIndex++) {
      const at = ordered[frameIndex]!,
        seconds = secondsAt(at, score.tempoMap),
        starting = units.filter((n) => compareQ(n.onset, at) === 0),
        next: Path<State, Realization, Annotation>[] = [],
        bar = barAt(at, score.meterMap),
        newBar = !frameIndex || barAt(ordered[frameIndex - 1]!, score.meterMap) !== bar,
        picking = profile.rightHand === "pick",
        reserved = (mandatory.get(bar) ?? []).filter((o) => compareQ(o, at) > 0).length,
        ahead = (moments.get(bar) ?? []).filter((o) => compareQ(o, at) > 0).length;
      if (starting.length > 256) {
        truncated = true;
        return failure("search-exhausted", [
          "Simultaneous decision budget exceeded",
        ]);
      }
      // A moment of the source that keeps none of its notes loses the song's rhythm: it costs far more than leaving
      // out one of several notes that start together, so a simplification thins chords before it empties a beat.
      const identity = starting.some((u) => u.notes.some((n) => n.role !== "ornament"));
      for (const parent of frontier) {
        let count = 0;
        candidateSearch: for (const [chosenPath, picks] of choose(parent, starting)) {
          const emptied = identity && picks.length > 0 && picks.every((v) => !v.note);
          const path = emptied ? { ...chosenPath, cost: total({ ...chosenPath.cost, musicalLoss: chosenPath.cost.musicalLoss + EMPTIED_MOMENT }) } : chosenPath;
          // The chosen notes that have not ended: the parent's and this frame's. A quantized one may start later.
          const sounding = [...path.sounding, ...picks].filter((v) => v.note && compareQ(v.note.end, at) > 0),
            active = sounding.flatMap((v) => (compareQ(v.note!.onset, at) <= 0 ? [v.note!] : [])),
            chosen = picks.reduce<Trail<Variant>>((rest, item) => ({ item, rest }), path.chosen),
            attacks = active.filter((n) => compareQ(n.onset, at) === 0),
            voices = new Set(
              active.map((n) => JSON.stringify([n.partId, n.voiceId])),
            ).size;
          if (
            active.length > profile.maxPolyphony ||
            voices > profile.maxVoices
          )
            continue;
          if (
            attacks.some(
              (n) =>
                compareQ(
                  n.notes.reduce(
                    (sum, event) => addQ(sum, event.duration),
                    q(0),
                  ),
                  profile.minDuration,
                ) < 0 ||
                (profile.rhythmGrid &&
                  !isMultipleQ(n.onset, profile.rhythmGrid)),
            )
          )
            continue;
          const attackTimes = [
            ...path.attacks.filter((t) => t > seconds - 1 + 1e-9),
            ...attacks.map(() => seconds),
          ];
          if (attackTimes.length > profile.maxAttacksPerSecond) continue;
          // A bar may pick any number of notes one at a time; notes picked together (doubles) only while the bar
          // stays within the limit, counting the notes that must still start in it.
          const picked = picking ? (newBar ? 0 : path.picked) + attacks.length : 0,
            pickedAt = picking ? (newBar ? 0 : path.pickedAt) + (attacks.length ? 1 : 0) : 0;
          if (profile.maxPickedPerBar !== undefined && picked > pickedAt && picked + reserved > profile.maxPickedPerBar) continue;
          // Notes picked together at this moment that leave the bar's later moments too few picks are thinned first,
          // when one of them may be left out: a moment of the tune outranks a doubled note.
          if (profile.maxPickedPerBar !== undefined && attacks.length > 1 && picked + ahead > profile.maxPickedPerBar && attacks.some((n) => optional.has(n.id))) continue;
          const frame: AdapterFrame = {
            at,
            seconds,
            active,
            attackIds: attacks.map((n) => n.id),
          };
          for (const realization of adapter.enumerate(
            frame,
            path.realization,
            context,
          )) {
            if (count++ >= search.maxCandidatesPerFrame) {
              truncated = true;
              discarded++;
              break candidateSearch;
            }
            tick();
            const transition = adapter.transition(
              path.state,
              path.realization,
              realization,
              frame,
              context,
            );
            if (!transition.valid) continue;
            const nextTime = ordered[frameIndex + 1] ?? at,
              weight = numberQ(subQ(nextTime, at)),
              ergonomics = adapter.ergonomicCost(realization, context) * weight,
              style = options.scoring?.cost(frame, realization) ?? 0;
            if (
              !Number.isFinite(style) ||
              style < 0 ||
              !Number.isFinite(ergonomics) ||
              ergonomics < 0 ||
              !Number.isFinite(transition.cost) ||
              transition.cost < 0
            )
              throw new RangeError("Costs must be nonnegative and finite");
            next.push({
              ...path,
              chosen,
              sounding,
              state: transition.state,
              realization,
              history: { item: { frame, realization }, rest: path.history },
              annotations: {
                item: adapter.describe(realization, frame, context),
                rest: path.annotations,
              },
              attacks: attackTimes,
              maxAttacks: Math.max(path.maxAttacks, attackTimes.length),
              picked,
              pickedAt,
              maxPicked: Math.max(path.maxPicked, picked),
              // With notes picked together, every later moment of the bar beyond the limit must stay empty.
              outlook:
                profile.maxPickedPerBar !== undefined && picked > pickedAt ? Math.max(0, picked + ahead - profile.maxPickedPerBar) * EMPTIED_MOMENT : 0,
              maxPolyphony: Math.max(path.maxPolyphony, active.length),
              maxVoices: Math.max(path.maxVoices, voices),
              maxShift: Math.max(path.maxShift, transition.shift),
              cost: total({
                musicalLoss: path.cost.musicalLoss,
                ergonomicCost: path.cost.ergonomicCost + ergonomics,
                transitionCost: path.cost.transitionCost + transition.cost,
                styleCost: path.cost.styleCost + style,
              }),
              serial: serial++,
            });
            yield {
              frame: frameIndex,
              frames: frameCount,
              expandedStates: expanded,
              frontier: frontier.length,
            };
          }
        }
        yield {
          frame: frameIndex,
          frames: frameCount,
          expandedStates: expanded,
          frontier: frontier.length,
        };
      }
      let candidates = next;
      if (strategy !== "exhaustive") {
        const states = new Map<string, Path<State, Realization, Annotation>>();
        for (const p of next) {
          const pending = p.sounding.map((v) => v.key);
          // The bar's picked notes only tell paths apart when a limit constrains what may follow.
          const key = JSON.stringify([
            adapter.stateKey(p.state, p.realization!),
            pending,
            p.ornaments,
            p.omissions,
            p.attacks,
            ...(profile.maxPickedPerBar !== undefined ? [p.picked, p.pickedAt] : []),
          ]);
          const existing = states.get(key);
          if (
            !existing ||
            p.cost.musicalLoss < existing.cost.musicalLoss ||
            (p.cost.musicalLoss === existing.cost.musicalLoss &&
              p.cost.total < existing.cost.total)
          ) {
            if (existing) dominated++;
            states.set(key, p);
          } else dominated++;
        }
        candidates = [...states.values()];
      }
      candidates.sort(
        (a, b) =>
          a.cost.musicalLoss + a.outlook - (b.cost.musicalLoss + b.outlook) ||
          a.cost.total - b.cost.total ||
          a.omissions - b.omissions ||
          a.serial - b.serial,
      );
      if (strategy === "beam" && candidates.length > search.beamWidth) {
        truncated = true;
        discarded += candidates.length - search.beamWidth;
        candidates = candidates.slice(0, search.beamWidth);
      }
      frontier = candidates;
      if (!frontier.length)
        return failure(truncated ? "search-exhausted" : "infeasible", [
          "No valid path within the declared candidate and mechanics model",
        ]);
    }
    const best = frontier[0]!;
    // Replay selected path independently before emitting any success.
    let state = adapter.initialState(),
      previous: Realization | undefined;
    for (const entry of trailArray(best.history)) {
      const violations = adapter.validateState(
        entry.realization,
        entry.frame,
        context,
      );
      if (violations.length)
        throw new Error(`Internal validation: ${violations.join("; ")}`);
      const transition = adapter.transition(
        state,
        previous,
        entry.realization,
        entry.frame,
        context,
      );
      if (!transition.valid)
        throw new Error(
          `Internal transition validation: ${transition.diagnostics.join("; ")}`,
        );
      state = transition.state;
      previous = entry.realization;
    }
    const completed = result(best);
    validateScore(completed.score);
    if (options.instrument && adapter.kind === "fretted") {
      const validation = validateFrettedArrangement(
        completed.score,
        options.instrument,
        completed.annotations as unknown as FrettedAnnotation[],
        { ...options.player, overrides: profile },
      );
      if (!validation.valid)
        throw new Error(
          `Independent replay failed: ${validation.diagnostics.join("; ")}`,
        );
    }
    return completed;
  } catch (error) {
    if (error instanceof Stop) {
      if (error.reason === "budget") truncated = true;
      return failure(
        error.reason === "cancelled" ? "cancelled" : "search-exhausted",
        [
          error.reason === "cancelled"
            ? "Cancelled during search"
            : "Expansion budget exceeded",
        ],
      );
    }
    return failure("invalid-input", [
      error instanceof Error ? error.message : String(error),
    ]);
  }
}
export function arrangeWithAdapter<State, Realization, Annotation>(
  source: Score,
  options: ArrangementOptions,
  adapter: InstrumentAdapter<State, Realization, Annotation>,
): ArrangementResult<Annotation> {
  const steps = arrangeSteps(source, options, adapter);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
export function arrange(
  source: Score,
  options: ArrangementOptions = {},
): ArrangementResult {
  try {
    const adapter = options.instrument
      ? createFrettedAdapter(options.instrument)
      : undefined;
    const steps = arrangeSteps<
      FrettedState,
      FrettedRealization,
      FrettedAnnotation
    >(source, options, adapter);
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
  } catch (e) {
    return {
      status: "invalid-input",
      diagnostics: [e instanceof Error ? e.message : String(e)],
      stats: {
        strategy: options.search?.strategy ?? "beam",
        frames: 0,
        expandedStates: 0,
        discardedCandidates: 0,
        dominatedStates: 0,
        exhaustive: true,
      },
    };
  }
}
export interface AsyncOptions {
  readonly yieldEvery?: number;
  readonly schedule?: () => Promise<void>;
  readonly onProgress?: (progress: SearchProgress) => void;
}
const defaultSchedule = (): Promise<void> =>
  new Promise((resolve) => {
    const host = globalThis as unknown as {
      setTimeout: (f: () => void, ms: number) => unknown;
    };
    host.setTimeout(resolve, 0);
  });
export async function arrangeAsync(
  source: Score,
  options: ArrangementOptions = {},
  asyncOptions: AsyncOptions = {},
): Promise<ArrangementResult> {
  const every = asyncOptions.yieldEvery ?? 128;
  if (!Number.isSafeInteger(every) || every < 1)
    throw new RangeError("Invalid yieldEvery");
  let adapter: ReturnType<typeof createFrettedAdapter> | undefined;
  try {
    adapter = options.instrument
      ? createFrettedAdapter(options.instrument)
      : undefined;
  } catch {
    return arrange(source, options);
  }
  const steps = arrangeSteps(source, options, adapter);
  let step = steps.next(),
    count = 0;
  while (!step.done) {
    if (++count % every === 0) {
      asyncOptions.onProgress?.(step.value);
      await (asyncOptions.schedule ?? defaultSchedule)();
    }
    step = steps.next();
  }
  return step.value;
}
