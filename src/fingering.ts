import {
  enumeratePositions,
  validateInstrument,
  fretDistanceMm,
} from "./fretted.js";
import { pitchString } from "./model.js";
import type { FrettedInstrument, Position } from "./fretted.js";
import type {
  InstrumentAdapter,
  AdapterFrame,
  MechanicsContext,
  TransitionEvaluation,
} from "./adapters.js";
import type { Q } from "./time.js";
import type { PlayerCapabilities } from "./profiles.js";
export interface FrettedAssignment extends Position {
  readonly id: string;
  readonly noteIds: readonly string[];
  readonly finger: 0 | 1 | 2 | 3 | 4;
}
export interface FingerContact {
  readonly finger: number;
  readonly fret: number;
  readonly fromString: number;
  readonly toString: number;
}
export interface FrettedRealization {
  readonly assignments: readonly FrettedAssignment[];
  readonly contacts: readonly FingerContact[];
  readonly spanFrets: number;
  readonly reachMm: number | null;
  readonly shape: string;
}
export interface FingerMemory {
  readonly contact: FingerContact;
  readonly releasedAt: number | null;
}
export interface FrettedState {
  readonly fingers: Readonly<Record<number, FingerMemory>>;
}
export interface FrettedAnnotation extends FrettedRealization {
  readonly at: Q;
  readonly attackIds: readonly string[];
  readonly mutedStringIds: readonly string[];
  readonly rightHand: "pick" | "strum";
}
function sameContact(a: FingerContact, b: FingerContact): boolean {
  return (
    a.fret === b.fret &&
    a.fromString === b.fromString &&
    a.toString === b.toString
  );
}
function contactsFor(
  assignments: readonly FrettedAssignment[],
  instrument: FrettedInstrument,
): FingerContact[] {
  const result: FingerContact[] = [];
  for (let finger = 1; finger <= 4; finger++) {
    const a = assignments.filter((p) => p.finger === finger);
    if (!a.length) continue;
    const indices = a.map((p) =>
      instrument.strings.findIndex((s) => s.id === p.stringId),
    );
    result.push({
      finger,
      fret: a[0]!.absoluteFret,
      fromString: Math.min(...indices),
      toString: Math.max(...indices),
    });
  }
  return result;
}
function distance(
  a: FingerContact,
  b: FingerContact,
  instrument: FrettedInstrument,
): number {
  return Math.hypot(
    fretDistanceMm(instrument.scaleLengthMm!, a.fret) -
      fretDistanceMm(instrument.scaleLengthMm!, b.fret),
    ((a.fromString + a.toString - (b.fromString + b.toString)) / 2) *
      instrument.stringSpacingMm!,
  );
}
function makeRealization(
  assignments: readonly FrettedAssignment[],
  instrument: FrettedInstrument,
  preserved: readonly FingerContact[] = [],
): FrettedRealization {
  // A held finger keeps its contact, widened at its fret to the strings it now also presses (a barre laid flat
  // around a held note); at another fret it stays as it was, and validation rejects the move.
  const contacts = contactsFor(assignments, instrument).map((c) => {
      const kept = preserved.find((p) => p.finger === c.finger);
      if (!kept) return c;
      return kept.fret === c.fret
        ? { ...kept, fromString: Math.min(kept.fromString, c.fromString), toString: Math.max(kept.toString, c.toString) }
        : kept;
    }),
    frets = contacts.map((c) => c.fret),
    spanFrets = frets.length ? Math.max(...frets) - Math.min(...frets) : 0;
  let reachMm: number | null = null;
  if (instrument.scaleLengthMm && instrument.stringSpacingMm) {
    reachMm = 0;
    const points = contacts.flatMap((c) => [
      { fret: c.fret, index: c.fromString },
      { fret: c.fret, index: c.toString },
    ]);
    for (const a of points)
      for (const b of points)
        reachMm = Math.max(
          reachMm,
          Math.hypot(
            fretDistanceMm(instrument.scaleLengthMm, a.fret) -
              fretDistanceMm(instrument.scaleLengthMm, b.fret),
            (a.index - b.index) * instrument.stringSpacingMm,
          ),
        );
  }
  return {
    assignments: [...assignments],
    contacts,
    spanFrets,
    reachMm,
    shape: instrument.strings
      .map(
        (s) =>
          assignments.find((p) => p.stringId === s.id)?.relativeFret ?? "x",
      )
      .join("-"),
  };
}
export function createFrettedAdapter(
  instrument: FrettedInstrument,
): InstrumentAdapter<FrettedState, FrettedRealization, FrettedAnnotation> {
  validateInstrument(instrument);
  instrument = {
    ...instrument,
    strings: instrument.strings.map((s) => ({ ...s })),
  };
  const positionCache = new Map<string, Position[]>();
  function locations(pitch: string): Position[] {
    let positions = positionCache.get(pitch);
    if (!positions) {
      positions = enumeratePositions(pitch, instrument);
      positionCache.set(pitch, positions);
    }
    return positions;
  }
  function validate(
    r: FrettedRealization,
    frame: AdapterFrame,
    { player: p }: MechanicsContext,
  ): string[] {
    const errors: string[] = [];
    const used = new Set<string>();
    if (
      r.assignments.length !== frame.active.length ||
      new Set(r.assignments.map((a) => a.id)).size !== r.assignments.length
    )
      errors.push("Wrong assignment multiplicity");
    for (const a of r.assignments) {
      const n = frame.active.find((n) => n.id === a.id);
      if (n && JSON.stringify(a.noteIds) !== JSON.stringify(n.noteIds))
        errors.push("Incorrect note identities");
      if (
        !n ||
        !locations(pitchString(n.pitch)).some(
          (pos) =>
            pos.stringId === a.stringId &&
            pos.absoluteFret === a.absoluteFret &&
            pos.relativeFret === a.relativeFret &&
            pos.effectiveOpen === a.effectiveOpen &&
            pos.stringNumber === a.stringNumber,
        )
      )
        errors.push("Assignment pitch/location mismatch");
      if (used.has(a.stringId)) errors.push("String occupied twice");
      used.add(a.stringId);
      if (
        !Number.isInteger(a.finger) ||
        a.finger < 0 ||
        a.finger > 4 ||
        (a.effectiveOpen ? a.finger !== 0 : a.finger === 0)
      )
        errors.push("Invalid finger");
      if (a.absoluteFret > p.maxFret) errors.push("Player fret limit");
    }
    const minimal = contactsFor(r.assignments, instrument);
    if (
      r.contacts.length !== minimal.length ||
      new Set(r.contacts.map((c) => c.finger)).size !== r.contacts.length
    )
      errors.push("Invalid contact count");
    for (const c of r.contacts) {
      const m = minimal.find((m) => m.finger === c.finger);
      if (
        !m ||
        c.fret !== m.fret ||
        !Number.isInteger(c.fromString) ||
        !Number.isInteger(c.toString) ||
        c.fromString < 0 ||
        c.toString >= instrument.strings.length ||
        c.fromString > m.fromString ||
        c.toString < m.toString
      )
        errors.push("Contact does not cover assigned notes");
    }
    const expected = makeRealization(r.assignments, instrument, r.contacts);
    if (
      JSON.stringify(expected.contacts) !== JSON.stringify(r.contacts) ||
      r.spanFrets !== expected.spanFrets ||
      r.reachMm !== expected.reachMm ||
      r.shape !== expected.shape
    )
      errors.push("Invalid hand metrics");
    if (r.spanFrets > p.maxFretSpan) errors.push("Fret span limit");
    if (
      p.maxReachMm !== undefined &&
      (r.reachMm === null || r.reachMm > p.maxReachMm + 1e-9)
    )
      errors.push("Reach geometry limit");
    if (p.fingerPairMaxMm) {
      if (!instrument.scaleLengthMm || !instrument.stringSpacingMm)
        errors.push("Finger-pair limits require geometry");
      else
        for (const a of r.contacts)
          for (const b of r.contacts) {
            const key = `${a.finger}-${b.finger}` as keyof NonNullable<
                typeof p.fingerPairMaxMm
              >,
              limit = p.fingerPairMaxMm[key];
            if (limit !== undefined) {
              const dx =
                  fretDistanceMm(instrument.scaleLengthMm, a.fret) -
                  fretDistanceMm(instrument.scaleLengthMm, b.fret),
                dy =
                  Math.max(
                    Math.abs(a.fromString - b.toString),
                    Math.abs(a.toString - b.fromString),
                  ) * instrument.stringSpacingMm;
              if (Math.hypot(dx, dy) > limit + 1e-9)
                errors.push("Finger-pair reach limit");
            }
          }
    }
    for (const c of r.contacts) {
      const group = r.assignments.filter((a) => a.finger === c.finger);
      if (group.some((a) => a.absoluteFret !== c.fret))
        errors.push("Finger assigned different frets");
      if (c.toString > c.fromString) {
        if (!p.allowBarre || c.toString - c.fromString + 1 > p.maxBarreStrings)
          errors.push("Barre limit");
        for (
          let i = Math.max(0, c.fromString);
          i <= Math.min(c.toString, instrument.strings.length - 1);
          i++
        ) {
          const s = instrument.strings[i]!,
            a = r.assignments.find((a) => a.stringId === s.id);
          if (
            s.capoFret >= c.fret ||
            (a && (a.effectiveOpen || a.absoluteFret < c.fret))
          )
            errors.push("Barre conflicts with capo/open/lower note");
        }
      }
      for (const other of r.contacts)
        if (c.finger < other.finger && c.fret > other.fret)
          errors.push("Crossed finger order");
    }
    if (p.rightHand === "strum" && frame.attackIds.length) {
      const attacked = r.assignments.filter((a) =>
          frame.attackIds.includes(a.id),
        ),
        indices = attacked.map((a) =>
          instrument.strings.findIndex((s) => s.id === a.stringId),
        );
      const first = Math.min(...indices),
        last = Math.max(...indices);
      for (let i = first; i <= last; i++) {
        const a = r.assignments.find(
          (a) => a.stringId === instrument.strings[i]!.id,
        );
        if (a && !frame.attackIds.includes(a.id))
          errors.push("Strum would reattack a held note");
        if (!a && !p.allowMutedStrum)
          errors.push("Strum crosses an unmuted unintended string");
      }
    }
    return errors;
  }
  function* enumerate(
    frame: AdapterFrame,
    previous: FrettedRealization | undefined,
    context: MechanicsContext,
  ): Generator<FrettedRealization> {
    const held = new Map(
      (previous?.assignments ?? [])
        .filter(
          (a) =>
            frame.active.some((n) => n.id === a.id) &&
            !frame.attackIds.includes(a.id),
        )
        .map((a) => [a.id, a]),
    );
    const preserved = (previous?.contacts ?? []).filter((c) =>
      [...held.values()].some((a) => a.finger === c.finger),
    );
    const notes = [...frame.active].sort(
      (a, b) =>
        Number(held.has(b.id)) - Number(held.has(a.id)) ||
        a.id.localeCompare(b.id),
    );
    function* visit(
      i: number,
      assigned: FrettedAssignment[],
    ): Generator<FrettedRealization> {
      if (i === notes.length) {
        context.tick();
        const r = makeRealization(assigned, instrument, preserved);
        if (!validate(r, frame, context).length) yield r;
        return;
      }
      const note = notes[i]!,
        fixed = held.get(note.id);
      const positions = fixed ? [fixed] : locations(pitchString(note.pitch));
      for (const pos of positions) {
        if (
          assigned.some((a) => a.stringId === pos.stringId) ||
          pos.absoluteFret > context.player.maxFret
        )
          continue;
        const fingers = fixed
          ? [fixed.finger]
          : pos.effectiveOpen
            ? [0]
            : [1, 2, 3, 4];
        for (const finger of fingers) {
          context.tick();
          if (
            finger &&
            assigned.some(
              (a) => a.finger === finger && a.absoluteFret !== pos.absoluteFret,
            )
          )
            continue;
          if (
            finger &&
            assigned.some(
              (a) =>
                a.finger &&
                ((a.finger < finger && a.absoluteFret > pos.absoluteFret) ||
                  (a.finger > finger && a.absoluteFret < pos.absoluteFret)),
            )
          )
            continue;
          const next = [
            ...assigned,
            {
              ...pos,
              id: note.id,
              noteIds: note.noteIds,
              finger: finger as FrettedAssignment["finger"],
            },
          ];
          const frets = next.filter((a) => a.finger).map((a) => a.absoluteFret);
          if (
            frets.length &&
            Math.max(...frets) - Math.min(...frets) > context.player.maxFretSpan
          )
            continue;
          yield* visit(i + 1, next);
        }
      }
    }
    yield* visit(0, []);
  }
  function transition(
    state: FrettedState,
    from: FrettedRealization | undefined,
    to: FrettedRealization,
    frame: AdapterFrame,
    { player: p }: MechanicsContext,
  ): TransitionEvaluation<FrettedState> {
    const fingers: Record<number, FingerMemory> = { ...state.fingers };
    let shift = 0,
      cost = 0;
    const diagnostics: string[] = [];
    for (const old of from?.assignments ?? []) {
      if (
        frame.active.some((n) => n.id === old.id) &&
        !frame.attackIds.includes(old.id)
      ) {
        const next = to.assignments.find((n) => n.id === old.id);
        if (
          !next ||
          old.stringId !== next.stringId ||
          old.absoluteFret !== next.absoluteFret ||
          old.finger !== next.finger
        )
          diagnostics.push("Held note assignment changed");
      }
    }
    for (let finger = 1; finger <= 4; finger++) {
      const old = from?.contacts.find((c) => c.finger === finger),
        next = to.contacts.find((c) => c.finger === finger),
        continuing = (from?.assignments ?? []).some(
          (a) =>
            a.finger === finger &&
            to.assignments.some((b) => b.id === a.id) &&
            !frame.attackIds.includes(a.id),
        );
      // A finger that keeps holding a note stays at its fret. It may lay flat over more strings there (a barre placed
      // around the note, as an arpeggio over a barre chord needs) or lift part of a barre, since its contact always
      // covers the notes it still holds; it may not move to another fret.
      if (continuing && old && (!next || next.fret !== old.fret))
        diagnostics.push("Held finger/barre cannot move");
      let memory = fingers[finger];
      if (old && !continuing)
        memory = { contact: old, releasedAt: frame.seconds };
      if (next) {
        if (memory && !sameContact(memory.contact, next)) {
          if (memory.releasedAt === null) {
            if (continuing && next.fret === memory.contact.fret)
              cost += (Math.abs(next.fromString - memory.contact.fromString) + Math.abs(next.toString - memory.contact.toString)) * 0.25 / 12;
            else diagnostics.push("Finger still held");
          } else {
            const available = frame.seconds - memory.releasedAt,
              frets = Math.abs(next.fret - memory.contact.fret),
              strings = Math.max(
                Math.abs(next.fromString - memory.contact.fromString),
                Math.abs(next.toString - memory.contact.toString),
              );
            const effective = Math.max(frets, strings * 0.25);
            let needed =
              p.fingerSetupSeconds + effective / p.maxShiftFretsPerSecond;
            if (p.maxFingerSpeedMmPerSecond !== undefined)
              needed = Math.max(
                needed,
                p.fingerSetupSeconds +
                  distance(memory.contact, next, instrument) /
                    p.maxFingerSpeedMmPerSecond,
              );
            if (available + 1e-9 < needed)
              diagnostics.push("Insufficient released-finger movement time");
            shift = Math.max(shift, frets);
            cost += effective / 12;
          }
        }
        fingers[finger] = { contact: next, releasedAt: null };
      } else if (memory) {
        fingers[finger] = memory;
      }
    }
    return {
      valid: !diagnostics.length,
      state: { fingers },
      cost,
      shift,
      diagnostics,
    };
  }
  return {
    kind: "fretted",
    version: "scorify-fretted-1",
    initialState: () => ({ fingers: {} }),
    enumerate,
    validateState: validate,
    transition,
    describe: (r, frame, context) => {
      const attacked = r.assignments
        .filter((a) => frame.attackIds.includes(a.id))
        .map((a) => instrument.strings.findIndex((s) => s.id === a.stringId));
      return {
        ...r,
        at: frame.at,
        attackIds: [...frame.attackIds],
        rightHand: context.player.rightHand,
        mutedStringIds:
          context.player.rightHand === "strum"
            ? instrument.strings
                .filter(
                  (s, i) =>
                    i >= Math.min(...attacked) &&
                    i <= Math.max(...attacked) &&
                    !r.assignments.some((a) => a.stringId === s.id),
                )
                .map((s) => s.id)
            : [],
      };
    },
    stateKey: (s, r) =>
      JSON.stringify([
        s,
        r.assignments.map((a) => [a.id, a.stringId, a.absoluteFret, a.finger]),
      ]),
    ergonomicCost: (r, { player: p }) =>
      r.spanFrets / 12 +
      r.contacts.length / 8 +
      r.contacts.filter((c) => c.toString > c.fromString).length / 8 +
      r.contacts.reduce((v, c) => v + c.fret, 0) / 96 +
      (p.familiarShapes.length && !p.familiarShapes.includes(r.shape)
        ? 0.25
        : 0) +
      highFretCost(r.assignments, p),
  };
}

/**
 * The difficulty's cost for the highest fretted note, counted from the capo as the tab reads (a capo is a movable
 * nut); the instrument's own fret count stays the hard limit.
 */
function highFretCost(
  assignments: readonly FrettedAssignment[],
  p: PlayerCapabilities,
): number {
  if (!p.highFretCosts.length) return 0;
  const top = Math.max(
    0,
    ...assignments.filter((a) => !a.effectiveOpen).map((a) => a.relativeFret),
  );
  return p.highFretCosts.reduce(
    (v, c) => v + Math.max(0, top - c.above) * c.perFret,
    0,
  );
}

/** Construct metrics/contact geometry for already assigned notes; validation is separate. */
export function realizeFrettedAssignments(
  assignments: readonly FrettedAssignment[],
  instrument: FrettedInstrument,
  contacts: readonly FingerContact[] = [],
): FrettedRealization {
  return makeRealization(assignments, instrument, contacts);
}
