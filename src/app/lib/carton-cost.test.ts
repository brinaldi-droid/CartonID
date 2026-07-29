import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { parseWorkbookToCartons, readCsv } from "./parsers";

describe("Packsize cost parsing", () => {
  it("reads Cost column with $ currency and Volume present", () => {
    const { rows } = parseWorkbookToCartons(
      readCsv(readFileSync("src/imports/Packsize.csv", "utf8")),
    );
    expect(rows.length).toBeGreaterThan(100);

    const first = rows[0];
    expect(first.cost).toBeGreaterThan(1);
    expect(first.cost).toBeCloseTo(13.57, 1);

    expect(rows.every((c) => c.cost > 0)).toBe(true);

    // Spot-check a mid row still maps cost (not Volume)
    const sample = rows.find((c) => c.name.includes("192514251325") || c.id.includes("192514251325"));
    expect(sample).toBeTruthy();
    expect(sample!.cost).toBeCloseTo(35.7, 0);
    expect(sample!.cost).not.toBeCloseTo(9.9748, 2); // must not pick Volume (ft³)
    expect(sample!.cost).not.toBeCloseTo(3634.64, 0); // must not pick Volume (in³)
  });
});
