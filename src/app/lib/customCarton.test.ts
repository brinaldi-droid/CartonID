import { describe, expect, it } from "vitest";
import { calcAI, cubePack, isOutsidePreferredUtil, suggestCustomCarton, UTIL_MAX, UTIL_MIN } from "./engine";
import type { Carton, SKU } from "./types";

function sku(partial: Partial<SKU> & Pick<SKU, "id" | "name" | "length" | "width" | "height">): SKU {
  return { category: "Test", weight: 1, fragility: "Low", ...partial };
}

function carton(partial: Partial<Carton> & Pick<Carton, "id" | "length" | "width" | "height">): Carton {
  return { name: partial.id, maxWeight: 100, cost: 5, ...partial };
}

describe("custom carton when outside preferred targets", () => {
  it("flags utilization outside 80–92%", () => {
    expect(isOutsidePreferredUtil({ utilization: 70 })).toBe(true);
    expect(isOutsidePreferredUtil({ utilization: 95 })).toBe(true);
    expect(isOutsidePreferredUtil({ utilization: 87 })).toBe(false);
  });

  it("suggests a tighter custom carton when Packsize util is too low", () => {
    const item = sku({ id: "S1", name: "Kit", length: 8, width: 6, height: 4, weight: 2 });
    // Oversized catalog carton → low utilization
    const big = carton({ id: "BIG", length: 24, width: 18, height: 16, cost: 20 });
    const pack = cubePack([{ sku: item, qty: 1 }], big);
    expect(pack.fits).toBe(true);
    expect(pack.utilization).toBeLessThan(UTIL_MIN);

    const custom = suggestCustomCarton([{ sku: item, qty: 1 }], pack, [big]);
    expect(custom).not.toBeNull();
    expect(custom!.score.utilization / 100).toBeGreaterThanOrEqual(UTIL_MIN - 0.02);
    expect(custom!.score.utilization / 100).toBeLessThanOrEqual(UTIL_MAX + 0.02);
    expect(custom!.carton.id.startsWith("CUSTOM-")).toBe(true);
    expect(custom!.score.total).toBeGreaterThan(0);
  });

  it("calcAI returns custom alongside Packsize when outside targets", () => {
    const item = sku({ id: "S2", name: "Device", length: 10, width: 8, height: 5, weight: 3 });
    const catalog = [
      carton({ id: "A", length: 28, width: 20, height: 18, cost: 25 }),
      carton({ id: "B", length: 26, width: 18, height: 16, cost: 22 }),
    ];
    const r = calcAI([{ sku: item, qty: 1 }], catalog);
    expect(r.noFit).toBe(false);
    expect(isOutsidePreferredUtil(r.score) || r.score.fitStatus === "not-recommended").toBe(true);
    expect(r.custom).not.toBeNull();
    expect(r.custom!.score.total).toBeGreaterThan(0);
    expect(r.cubing?.fits).toBe(true);
  });
});
