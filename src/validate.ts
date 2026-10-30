import { validateScore, soundingNotes, barAt } from "./model.js";
import { compilePlayer } from "./profiles.js";
import { createFrettedAdapter } from "./fingering.js";
import {
  compareQ,
  keyQ,
  secondsAt,
  subQ,
  isMultipleQ,
  addQ,
  q,
} from "./time.js";
import type { Score } from "./model.js";
import type { FrettedInstrument } from "./fretted.js";
import type { FrettedAnnotation, FrettedRealization } from "./fingering.js";
import type { PlayerOptions } from "./profiles.js";
/** Independent replay against output events, not the search engine's internal frames. */
export function validateFrettedArrangement(
  score: Score,
  instrument: FrettedInstrument,
  annotations: readonly FrettedAnnotation[],
  player: PlayerOptions = {},
): { readonly valid: boolean; readonly diagnostics: readonly string[] } {
  const errors: string[] = [];
  try {
    validateScore(score);
    const profile = compilePlayer(player),
      adapter = createFrettedAdapter(instrument),
      notes = soundingNotes(score),
      context = { player: profile, tick: () => {} };
    const required = new Set(
      notes.flatMap((n) => [keyQ(n.onset), keyQ(n.end)]),
    );
    let state = adapter.initialState(),
      previous: FrettedRealization | undefined;
    const attacks: number[] = [];
    // With strictly ordered annotations, active notes and the one-second attack window are swept forward: the same
    // notes in the same (score) order as filtering every note at every frame, without its quadratic cost.
    const ordered = annotations.every(
        (a, i) => !i || compareQ(annotations[i - 1]!.at, a.at) < 0,
      ),
      byOnset = notes
        .map((_, k) => k)
        .sort((x, y) => compareQ(notes[x]!.onset, notes[y]!.onset) || x - y);
    let next = 0,
      windowStart = 0,
      open: number[] = [],
      bar = -1,
      picked = 0,
      pickedAt = 0;
    for (let i = 0; i < annotations.length; i++) {
      const a = annotations[i]!;
      if (i && compareQ(annotations[i - 1]!.at, a.at) >= 0)
        errors.push("Annotations must be strictly ordered");
      required.delete(keyQ(a.at));
      let active: typeof notes;
      if (ordered) {
        while (next < byOnset.length && compareQ(notes[byOnset[next]!]!.onset, a.at) <= 0)
          open.push(byOnset[next++]!);
        open = open.filter((k) => compareQ(notes[k]!.end, a.at) > 0).sort((x, y) => x - y);
        active = open.map((k) => notes[k]!);
      } else
        active = notes.filter(
          (n) => compareQ(n.onset, a.at) <= 0 && compareQ(n.end, a.at) > 0,
        );
      const attackNotes = active.filter((n) => !compareQ(n.onset, a.at)),
        seconds = secondsAt(a.at, score.tempoMap),
        frame = {
          at: a.at,
          seconds,
          active,
          attackIds: attackNotes.map((n) => n.id),
        };
      if (
        JSON.stringify([...a.attackIds].sort()) !==
        JSON.stringify([...frame.attackIds].sort())
      )
        errors.push("Incorrect attacks");
      if (
        active.length > profile.maxPolyphony ||
        new Set(active.map((n) => JSON.stringify([n.partId, n.voiceId]))).size >
          profile.maxVoices
      )
        errors.push("Polyphony/voice limit");
      for (const n of attackNotes) {
        if (
          compareQ(
            n.notes.reduce((sum, event) => addQ(sum, event.duration), q(0)),
            profile.minDuration,
          ) < 0 ||
          (profile.rhythmGrid && !isMultipleQ(n.onset, profile.rhythmGrid))
        )
          errors.push("Rhythm capability limit");
        attacks.push(seconds);
      }
      let recent: number;
      if (ordered) {
        while (windowStart < attacks.length && !(attacks[windowStart]! > seconds - 1 + 1e-9)) windowStart++;
        recent = attacks.length - windowStart;
      } else recent = attacks.filter((t) => t > seconds - 1 + 1e-9).length;
      if (recent > profile.maxAttacksPerSecond)
        errors.push("Attack density limit");
      if (profile.rightHand === "pick" && profile.maxPickedPerBar !== undefined) {
        const b = barAt(a.at, score.meterMap);
        picked = (b === bar ? picked : 0) + attackNotes.length;
        pickedAt = (b === bar ? pickedAt : 0) + (attackNotes.length ? 1 : 0);
        bar = b;
        // One note at a time is always allowed; notes picked together only within the limit.
        if (picked > profile.maxPickedPerBar && picked > pickedAt) errors.push("Picked notes per bar limit");
      }
      errors.push(...adapter.validateState(a, frame, context));
      if (previous)
        for (const old of previous.assignments) {
          if (
            active.some((n) => n.id === old.id) &&
            !frame.attackIds.includes(old.id)
          ) {
            const current = a.assignments.find((n) => n.id === old.id);
            if (
              !current ||
              current.stringId !== old.stringId ||
              current.absoluteFret !== old.absoluteFret ||
              current.finger !== old.finger
            )
              errors.push("Sustained note changed physical assignment");
          }
        }
      const transition = adapter.transition(state, previous, a, frame, context);
      if (!transition.valid) errors.push(...transition.diagnostics);
      const description = adapter.describe(a, frame, context);
      if (
        a.rightHand !== description.rightHand ||
        JSON.stringify([...a.mutedStringIds].sort()) !==
          JSON.stringify([...description.mutedStringIds].sort())
      )
        errors.push("Incorrect right-hand annotation");
      state = transition.state;
      previous = a;
    }
    if (required.size) errors.push("Missing attack or release boundaries");
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  return { valid: errors.length === 0, diagnostics: [...new Set(errors)] };
}
