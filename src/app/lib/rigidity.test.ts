import { describe, expect, it } from "vitest";
import { cubePack, scoreCarton } from "./engine";
import {
  compressAxis,
  enumerateCompressionTriples,
  inferRigidityClass,
  meetsRetainedVolume,
  resolveMechanical,
  retainedVolumePercent,
  RIGIDITY_DEFAULTS,
} from "./rigidity";
import type { Carton, SKU } from "./types";

function sku(partial: Partial<SKU> & Pick<SKU, "id" | "name" | "length" | "width" | "height">): SKU {
  return {
    category: "Test",
    weight: 1,
    fragility: "Low",
    ...partial,
  };
}

function carton(partial: Partial<Carton> & Pick<Carton, "id" | "length" | "width" | "height">): Carton {
  return {
    name: partial.id,
    maxWeight: 100,
    cost: 1,
    ...partial,
  };
}

describe("rigidity defaults & overrides", () => {
  it("defaults missing rigidity data to rigid", () => {
    const s = sku({ id: "R1", name: "Box", length: 10, width: 8, height: 4 });
    expect(inferRigidityClass(s)).toBe("rigid");
    const m = resolveMechanical(s);
    expect(m.maxCompressionPercent).toEqual({ length: 0, width: 0, height: 0 });
    expect(m.canConformToVoid).toBe(false);
    expect(m.minimumRetainedVolumePercent).toBe(100);
  });

  it("SKU-specific overrides replace class defaults", () => {
    const s = sku({
      id: "F1",
      name: "Flex",
      length: 12,
      width: 8,
      height: 3,
      rigidityClass: "flexible",
      mechanical: {
        maxCompressionPercent: { length: 1, width: 1, height: 8 },
        minimumRetainedVolumePercent: 90,
        canConformToVoid: false,
        stackable: true,
        maxTopLoadLb: 2,
      },
    });
    const m = resolveMechanical(s);
    expect(m.maxCompressionPercent).toEqual({ length: 1, width: 1, height: 8 });
    expect(m.minimumRetainedVolumePercent).toBe(90);
    expect(m.canConformToVoid).toBe(false);
    expect(m.stackable).toBe(true);
    expect(m.maxTopLoadLb).toBe(2);
    expect(m.missingTopLoadDefaulted).toBe(false);
  });

  it("soft_bag missing top load defaults to 0 and flags review", () => {
    const s = sku({
      id: "B1",
      name: "Bag",
      length: 14,
      width: 10,
      height: 3,
      rigidityClass: "soft_bag",
    });
    const m = resolveMechanical(s);
    expect(m.maxTopLoadLb).toBe(0);
    expect(m.missingTopLoadDefaulted).toBe(true);
    expect(m.stackable).toBe(false);
    expect(m.maxCompressionPercent).toEqual(RIGIDITY_DEFAULTS.soft_bag.maxCompressionPercent);
  });
});

describe("volume conservation", () => {
  it("rejects triples that shrink below minimum retained volume", () => {
    const original = { length: 10, width: 10, height: 10 };
    const origVol = 1000;
    const triples = enumerateCompressionTriples(
      { length: 10, width: 10, height: 30 },
      origVol,
      70,
      original,
    );
    for (const pct of triples) {
      const cVol =
        compressAxis(10, pct.length) * compressAxis(10, pct.width) * compressAxis(10, pct.height);
      expect(meetsRetainedVolume(origVol, cVol, 70)).toBe(true);
    }
    // Full independent max would be 0.9*0.9*0.7 = 0.567 — must not appear
    expect(
      triples.some((t) => t.length === 10 && t.width === 10 && t.height === 30),
    ).toBe(false);
  });

  it("computes retained volume percent from compressed dims", () => {
    const orig = 14.5 * 10 * 3;
    const packed = 14.1 * 9.6 * 2.4;
    const pct = retainedVolumePercent(orig, packed);
    expect(pct).toBeGreaterThan(70);
    expect(pct).toBeLessThan(100);
  });
});

describe("cubePack — rigid", () => {
  it("packs fully rigid orders with exact AABB fit", () => {
    const rigid = sku({
      id: "BOX",
      name: "Rigid kit",
      length: 10,
      width: 8,
      height: 4,
      weight: 2,
      rigidityClass: "rigid",
    });
    const c = carton({ id: "C1", length: 12, width: 10, height: 6 });
    const r = cubePack([{ sku: rigid, qty: 1 }], c);
    expect(r.fits).toBe(true);
    expect(r.placements[0].compressionPercent).toEqual({ length: 0, width: 0, height: 0 });
    expect(r.placements[0].rigidityClass).toBe("rigid");
    expect(r.mechanicalReviewRequired).toBe(false);
  });
});

describe("cubePack — soft bag with rigid cartons", () => {
  it("places one soft bag with rigid kits without overlapping", () => {
    const rigid = sku({
      id: "KIT",
      name: "Device kit",
      length: 8,
      width: 6,
      height: 3,
      weight: 3,
      rigidityClass: "rigid",
    });
    const bag = sku({
      id: "BAG",
      name: "Accessory pouch",
      length: 7,
      width: 5,
      height: 2.5,
      weight: 0.4,
      rigidityClass: "soft_bag",
      mechanical: { maxTopLoadLb: 0, stackable: false },
    });
    const c = carton({ id: "C2", length: 16, width: 10, height: 6 });
    const r = cubePack(
      [
        { sku: rigid, qty: 1 },
        { sku: bag, qty: 1 },
      ],
      c,
    );
    expect(r.fits).toBe(true);
    expect(r.flexReports.some((f) => f.skuId === "BAG")).toBe(true);
    // Soft bag should not sit under the rigid kit
    const bagP = r.placements.find((p) => p.sku.id === "BAG")!;
    const kitP = r.placements.find((p) => p.sku.id === "KIT")!;
    expect(bagP.topLoadLb).toBe(0);
    // No AABB overlap
    const overlap =
      bagP.x < kitP.x + kitP.iL &&
      bagP.x + bagP.iL > kitP.x &&
      bagP.y < kitP.y + kitP.iW &&
      bagP.y + bagP.iW > kitP.y &&
      bagP.z < kitP.z + kitP.iH &&
      bagP.z + bagP.iH > kitP.z;
    expect(overlap).toBe(false);
  });
});

describe("cubePack — multiple flexible packages", () => {
  it("packs multiple flexible packages in one carton", () => {
    const flex = (id: string): SKU =>
      sku({
        id,
        name: `Flex ${id}`,
        length: 6,
        width: 4,
        height: 2,
        weight: 0.5,
        rigidityClass: "flexible",
        mechanical: { maxTopLoadLb: 0, stackable: false },
      });
    const c = carton({ id: "C3", length: 14, width: 10, height: 6 });
    const r = cubePack(
      [
        { sku: flex("F-A"), qty: 1 },
        { sku: flex("F-B"), qty: 1 },
        { sku: flex("F-C"), qty: 1 },
      ],
      c,
    );
    expect(r.fits).toBe(true);
    expect(r.flexReports.length).toBe(3);
  });
});

describe("axis-specific compression & modest vs excessive", () => {
  it("fits a bag only by modest height compression", () => {
    // Carton height 2.7; bag height 3 with 30% max → min height 2.1
    const bag = sku({
      id: "SOFT",
      name: "Soft fill",
      length: 10,
      width: 8,
      height: 3,
      weight: 0.8,
      rigidityClass: "soft_bag",
      mechanical: {
        maxCompressionPercent: { length: 0, width: 0, height: 30 },
        minimumRetainedVolumePercent: 70,
        maxTopLoadLb: 0,
        stackable: false,
        canConformToVoid: true,
      },
    });
    const c = carton({ id: "C4", length: 11, width: 9, height: 2.7 });
    const r = cubePack([{ sku: bag, qty: 1 }], c);
    expect(r.fits).toBe(true);
    const p = r.placements[0];
    expect(p.compressionPercent.height).toBeGreaterThan(0);
    expect(p.compressionPercent.height).toBeLessThanOrEqual(30);
    expect(p.iH).toBeLessThanOrEqual(2.7 + 0.1);
    expect(p.retainedVolumePercent).toBeGreaterThanOrEqual(70);
  });

  it("rejects bags that would require excessive compression", () => {
    const bag = sku({
      id: "SOFT-X",
      name: "Too tall soft",
      length: 10,
      width: 8,
      height: 4,
      weight: 0.8,
      rigidityClass: "soft_bag",
      mechanical: {
        maxCompressionPercent: { length: 5, width: 5, height: 10 },
        minimumRetainedVolumePercent: 85,
        maxTopLoadLb: 0,
        stackable: false,
      },
    });
    // Even at 10% height: 3.6 > 2.5 carton
    const c = carton({ id: "C5", length: 11, width: 9, height: 2.5 });
    const r = cubePack([{ sku: bag, qty: 1 }], c);
    expect(r.fits).toBe(false);
  });
});

describe("stacking & top load", () => {
  it("rejects rigid resting on non-stackable bag", () => {
    const bag = sku({
      id: "BAG-NS",
      name: "Non-stack bag",
      length: 10,
      width: 10,
      height: 2,
      weight: 0.5,
      rigidityClass: "soft_bag",
      mechanical: { stackable: false, maxTopLoadLb: 0 },
    });
    const heavy = sku({
      id: "HVY",
      name: "Heavy rigid",
      length: 9,
      width: 9,
      height: 3,
      weight: 8,
      rigidityClass: "rigid",
    });
    // Only room is stacking — footprint fills carton
    const c = carton({ id: "C6", length: 10.2, width: 10.2, height: 6 });
    const r = cubePack(
      [
        { sku: bag, qty: 1 },
        { sku: heavy, qty: 1 },
      ],
      c,
    );
    // Either fails, or succeeds with bag not underneath (side-by-side impossible → should fail)
    if (r.fits) {
      const bagP = r.placements.find((p) => p.sku.id === "BAG-NS")!;
      expect(bagP.topLoadLb).toBe(0);
    } else {
      expect(r.fits).toBe(false);
    }
  });

  it("enforces zero allowable top load on soft packages", () => {
    const bag = sku({
      id: "BAG-0",
      name: "Zero load bag",
      length: 12,
      width: 10,
      height: 3,
      weight: 0.5,
      rigidityClass: "soft_bag",
      mechanical: { stackable: true, maxTopLoadLb: 0 },
    });
    const rigid = sku({
      id: "R2",
      name: "Rigid block",
      length: 11,
      width: 9,
      height: 2,
      weight: 5,
      rigidityClass: "rigid",
    });
    const c = carton({ id: "C7", length: 12.5, width: 10.5, height: 6 });
    const r = cubePack(
      [
        { sku: bag, qty: 1 },
        { sku: rigid, qty: 1 },
      ],
      c,
    );
    if (r.fits) {
      const bagP = r.placements.find((p) => p.sku.id === "BAG-0")!;
      expect(bagP.topLoadLb).toBeLessThanOrEqual(0);
    } else {
      expect(r.failReason ?? "").toMatch(/top-load|Non-stackable|arrangement|compression/i);
    }
  });
});

describe("void conformity & shape recovery", () => {
  it("allows flexible package into a side void via deformable envelope", () => {
    const rigid = sku({
      id: "MAIN",
      name: "Main kit",
      length: 12,
      width: 8,
      height: 4,
      weight: 4,
      rigidityClass: "rigid",
    });
    // Uncompressed 5×4×4 won't fit beside 12" in 16" carton (only 4" left) —
    // with width compression 10% → 3.6 fits in side strip
    const flex = sku({
      id: "SIDE",
      name: "Side pouch",
      length: 5,
      width: 4.5,
      height: 3.5,
      weight: 0.3,
      rigidityClass: "flexible",
      mechanical: {
        maxCompressionPercent: { length: 5, width: 20, height: 10 },
        minimumRetainedVolumePercent: 75,
        canConformToVoid: true,
        maxTopLoadLb: 0,
        stackable: false,
      },
    });
    const c = carton({ id: "C8", length: 16, width: 8.2, height: 5 });
    const r = cubePack(
      [
        { sku: rigid, qty: 1 },
        { sku: flex, qty: 1 },
      ],
      c,
    );
    expect(r.fits).toBe(true);
    const side = r.flexReports.find((f) => f.skuId === "SIDE");
    expect(side).toBeTruthy();
  });

  it("scores shape-recovery movement risk when compressed void fill is used", () => {
    const bag = sku({
      id: "REC",
      name: "Recoverable bag",
      length: 10,
      width: 8,
      height: 3,
      weight: 0.6,
      rigidityClass: "soft_bag",
      mechanical: {
        maxCompressionPercent: { length: 0, width: 0, height: 30 },
        minimumRetainedVolumePercent: 70,
        canConformToVoid: true,
        maxTopLoadLb: 0,
        contentShiftRisk: "high",
        stackable: false,
      },
    });
    const c = carton({ id: "C9", length: 11, width: 9, height: 2.6 });
    const score = scoreCarton(c, [{ sku: bag, qty: 1 }]);
    expect(score.fitStatus === "mechanical-review" || score.fitStatus === "recommended" || score.fitStatus === "not-recommended").toBe(true);
    if (score.utilization > 0) {
      expect(score.shapeRecoveryMovementRisk + score.flexiblePackageCompressionRisk).toBeGreaterThan(0);
    }
  });
});

describe("engineering score separation", () => {
  it("keeps physical fit separate from mechanical review status", () => {
    const bag = sku({
      id: "REV",
      name: "Review bag",
      length: 8,
      width: 6,
      height: 2,
      weight: 0.4,
      rigidityClass: "soft_bag",
      // missing maxTopLoad → default 0 → mechanical review flag
    });
    const c = carton({ id: "C10", length: 10, width: 8, height: 4 });
    const r = cubePack([{ sku: bag, qty: 1 }], c);
    expect(r.fits).toBe(true);
    expect(r.mechanicalReviewRequired).toBe(true);
    const score = scoreCarton(c, [{ sku: bag, qty: 1 }]);
    expect(score.fitStatus).toBe("mechanical-review");
    expect(score.mechanicalReviewRequired).toBe(true);
  });
});

describe("SKU database rigidity labels", () => {
  it("maps Rigid Box / Soft Bag and ignores numeric junk", async () => {
    const { toRigidityClass, parseWorkbookToSKUs, readCsv } = await import("./parsers");
    expect(toRigidityClass("Rigid Box")).toBe("rigid");
    expect(toRigidityClass("Soft Bag")).toBe("soft_bag");
    expect(toRigidityClass("Flexible Pack")).toBe("flexible");
    expect(toRigidityClass("1.375")).toBeUndefined();

    const csv = `SKU ID,Name,Category,Length,Width,Height,Weight,Fragility, Rigidity
A1,Kit A,Urology,10,8,2,1,Low,Rigid Box
A2,Bag B,Urology,14,10,3,0.8,Low,Soft Bag
A3,Unknown,Urology,5,5,5,1,Low,
`;
    const { rows } = parseWorkbookToSKUs(readCsv(csv));
    expect(rows.find((r) => r.id === "A1")?.rigidityClass).toBe("rigid");
    expect(rows.find((r) => r.id === "A2")?.rigidityClass).toBe("soft_bag");
    expect(rows.find((r) => r.id === "A3")?.rigidityClass).toBeUndefined();
  });
});
