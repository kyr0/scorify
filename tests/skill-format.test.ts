import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  arrange,
  normalizeScore,
  classicalGuitar,
  concertUkulele,
} from "../src/index.js";
import type { Score } from "../src/index.js";
// The score-import skill (skills/score-import/) is independent of this package; its committed outputs must stay valid scorify input.
const files = [
  ...readdirSync("skills/score-import/tests/fixtures")
    .filter((f) => f.endsWith(".scorify.json"))
    .map((f) => join("skills/score-import/tests/fixtures", f)),
  ...readdirSync("docs/assets/scores")
    .filter((f) => f.endsWith(".scorify.json"))
    .map((f) => join("docs/assets/scores", f)),
];
const load = (file: string): Score =>
  JSON.parse(readFileSync(file, "utf8")) as Score;
describe("score-import skill output", () => {
  it.each(files)("%s is accepted by normalizeScore", (file) => {
    const score = normalizeScore(load(file));
    expect(score.notes.length).toBeGreaterThan(0);
    expect(score.notes.some((n) => n.role === "melody")).toBe(true);
    const source = (score.notation as { source?: { format?: string } })
      .source;
    expect(source?.format).toBeTruthy();
  });
  it.each(files.filter((f) => f.startsWith("skills/")))(
    "%s arranges in adaptive mode with its melody kept",
    (file) => {
      const score = normalizeScore(load(file));
      for (const instrument of [concertUkulele(), classicalGuitar()]) {
        const result = arrange(score, {
          instrument,
          mode: "adaptive",
          adaptation: {
            preserveMelody: true,
            allowOctaveShift: true,
            allowAccompanimentOmission: true,
          },
        });
        expect(result.status).toBe("success");
        if (result.status !== "success") continue;
        const melody = new Set(
          score.notes.filter((n) => n.role === "melody").map((n) => n.id),
        );
        const omitted = result.edits
          .filter((e) => e.kind === "omit")
          .flatMap((e) => e.sourceIds);
        expect(omitted.filter((id) => melody.has(id))).toEqual([]);
      }
    },
  );
});
