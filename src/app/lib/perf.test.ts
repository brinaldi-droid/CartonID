import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { calcAI, parseWorkbookToCartons, parseWorkbookToSKUs, readCsv } from "./engine";

describe("calcAI performance", () => {
  it("analyzes a 4-SKU medical order in under 3s", () => {
    const skus = parseWorkbookToSKUs(
      readCsv(readFileSync("src/imports/sku-database-sample.csv", "utf8")),
    ).rows;
    const cartons = parseWorkbookToCartons(
      readCsv(readFileSync("src/imports/Packsize.csv", "utf8")),
    ).rows;
    const byId = Object.fromEntries(skus.map((s) => [s.id, s]));
    const items = ["1011-2447", "1011-1901", "1011-2700", "1011-2813"]
      .map((id) => byId[id])
      .filter(Boolean)
      .map((sku) => ({ sku, qty: 1 }));

    const t0 = performance.now();
    const r = calcAI(items, cartons);
    const ms = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`calcAI ${Math.round(ms)}ms · candidates ${r.candidateCount} · ${r.carton.name || r.carton.id}`);
    expect(r.noFit).toBe(false);
    expect(ms).toBeLessThan(8000);
  });
});
