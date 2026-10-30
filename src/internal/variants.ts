import { parsePitch, pitchString } from "../model.js";
import { addQ, subQ, mulQ, ceilGrid, compareQ, q, numberQ } from "../time.js";
import type { SoundingNote, NoteEvent, Edit } from "../model.js";
import type { AdaptationPolicy, PlayerProfile } from "../profiles.js";
export interface Variant {
  readonly key: string;
  readonly unitId: string;
  readonly note: SoundingNote | null;
  readonly edits: readonly Edit[];
  readonly loss: number;
  readonly ornament: number;
  readonly omitted: number;
}
export function variantsFor(
  unit: SoundingNote,
  adaptive: boolean,
  a: AdaptationPolicy,
  p: PlayerProfile,
): Variant[] {
  const variants: Variant[] = [];
  const ids = unit.noteIds,
    locked = (key: "keep" | "pitch" | "onset" | "duration") =>
      unit.notes.some((n) => n.locked?.[key]),
    protectedNote = ids.some((id) => a.protectedNoteIds.includes(id));
  const melody = unit.notes.some((n) => n.role === "melody"),
    ornament = unit.notes.every((n) => n.role === "ornament"),
    accompaniment = unit.notes.every(
      (n) => n.role === "harmony" || n.role === "bass",
    );
  const salience = Math.max(
    ...unit.notes.map(
      (n) =>
        n.importance ??
        (n.role === "melody"
          ? 1
          : n.role === "bass"
            ? 0.8
            : n.role === "ornament"
              ? 0.2
              : 0.5),
    ),
  );
  const pitches = [unit.pitch];
  if (adaptive && a.allowOctaveShift && !locked("pitch") && !protectedNote)
    for (const octaves of a.octaveShifts) {
      if (!octaves) continue;
      try {
        const pitch = parsePitch(
          pitchString({ ...unit.pitch, octave: unit.pitch.octave + octaves }),
        );
        if (!pitches.some((p) => pitchString(p) === pitchString(pitch)))
          pitches.push(pitch);
      } catch {
        /* finite candidate outside MIDI range */
      }
    }
  const timings = [
    {
      onset: unit.onset,
      end: unit.end,
      notes: unit.notes,
      edits: [] as Edit[],
      loss: 0,
    },
  ];
  if (adaptive && unit.notes.length === 1 && !protectedNote) {
    const original = unit.notes[0]!;
    if (a.allowRhythmSimplification && !locked("onset")) {
      const onset = ceilGrid(unit.onset, a.rhythmGrid),
        delay = subQ(onset, unit.onset);
      if (compareQ(delay, q(0)) > 0 && compareQ(delay, a.maxOnsetDelay) <= 0) {
        const note = { ...original, onset };
        timings.push({
          onset,
          end: addQ(unit.end, delay),
          notes: [note],
          edits: [
            {
              kind: "rhythm",
              sourceIds: ids,
              outputIds: ids,
              before: unit.onset,
              after: onset,
              reason: "Delay to allowed rhythmic grid",
              permission: "adaptation.allowRhythmSimplification",
            },
          ],
          loss: numberQ(delay) * (1 + salience),
        });
      }
    }
    if (a.allowRhythmSimplification && !locked("duration"))
      for (const timing of [...timings]) {
        const current = timing.notes[0]!,
          duration = ceilGrid(current.duration, a.rhythmGrid);
        if (compareQ(duration, current.duration) > 0 && !current.gateDuration) {
          const note = { ...current, duration };
          timings.push({
            ...timing,
            end: addQ(timing.onset, duration),
            notes: [note],
            edits: [
              ...timing.edits,
              {
                kind: "rhythm",
                sourceIds: ids,
                outputIds: ids,
                before: { duration: current.duration },
                after: { duration },
                reason: "Lengthen to allowed rhythmic pulse",
                permission: "adaptation.allowRhythmSimplification",
              },
            ],
            loss:
              timing.loss +
              numberQ(subQ(duration, current.duration)) * (1 + salience),
          });
        }
      }
    if (a.allowHoldShortening && !locked("duration"))
      for (const timing of [...timings])
        for (const ratio of a.gateRatios) {
          const gate = mulQ(
              subQ(timing.end, timing.onset),
              q(Math.round(ratio * 1000000), 1000000),
            ),
            end = addQ(timing.onset, gate);
          if (compareQ(gate, q(0)) <= 0) continue;
          const note = { ...timing.notes[0]!, gateDuration: gate };
          timings.push({
            onset: timing.onset,
            end,
            notes: [note],
            edits: [
              ...timing.edits,
              {
                kind: "hold",
                sourceIds: ids,
                outputIds: ids,
                before: subQ(timing.end, timing.onset),
                after: gate,
                reason: "Explicitly permitted earlier release",
                permission: "adaptation.allowHoldShortening",
              },
            ],
            loss: timing.loss + (1 - ratio) * (1 + salience),
          });
        }
  }
  for (const pitch of pitches)
    for (const t of timings) {
      const delta = pitch.octave - unit.pitch.octave,
        edits = [...t.edits];
      if (delta)
        edits.push({
          kind: "octave",
          sourceIds: ids,
          outputIds: ids,
          before: unit.pitch,
          after: pitch,
          reason: "Instrument register adaptation",
          permission: "adaptation.allowOctaveShift",
        });
      const notes = t.notes.map((n) => ({
        ...n,
        pitch,
        sourceIds: n.sourceIds ?? [n.id],
      }));
      variants.push({
        key: `${unit.id}:${variants.length}`,
        unitId: unit.id,
        note: { ...unit, onset: t.onset, end: t.end, pitch, notes },
        edits,
        loss: t.loss + Math.abs(delta) * (1 + salience * 3),
        ornament: ornament ? 1 : 0,
        omitted: 0,
      });
    }
  if (
    adaptive &&
    !locked("keep") &&
    !protectedNote &&
    !(melody && a.preserveMelody) &&
    ((ornament && a.allowOrnamentOmission) ||
      (accompaniment && a.allowAccompanimentOmission) ||
      (melody && a.allowMelodyOmission && !a.preserveMelody))
  )
    variants.push({
      key: `${unit.id}:omit`,
      unitId: unit.id,
      note: null,
      edits: [
        {
          kind: "omit",
          sourceIds: ids,
          outputIds: [],
          before: unit.notes,
          after: null,
          reason: ornament
            ? "Reduce ornament complexity"
            : melody
              ? "Explicitly allowed melody skeleton reduction"
              : "Reduce accompaniment demands",
          permission: ornament
            ? "adaptation.allowOrnamentOmission"
            : melody
              ? "adaptation.allowMelodyOmission"
              : "adaptation.allowAccompanimentOmission",
        },
      ],
      loss: 2 + salience * 12,
      ornament: 0,
      omitted: 1,
    });
  return variants.sort((a, b) => a.loss - b.loss || a.key.localeCompare(b.key));
}
export function outputNotes(chosen: readonly Variant[]): NoteEvent[] {
  return chosen.flatMap((c) => c.note?.notes ?? []);
}
