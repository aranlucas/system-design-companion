// The overlap-removal and alignment solver behind tidy, on its own.
import { describe, expect, it } from "vitest";
import { solveLayout, type Box, type LayoutItem } from "../src/worker/solve-layout.ts";

const GAP = 24;
const opts = { gap: GAP, alignTolerance: 16 };

function crowd(n: number, seed: number): LayoutItem[] {
  let r = seed;
  const rand = () => (r = (r * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  return Array.from({ length: n }, () => ({
    box: {
      x: Math.round(rand() * 700),
      y: Math.round(rand() * 450),
      w: 120 + Math.round(rand() * 80),
      h: 60 + Math.round(rand() * 40),
    },
    alignable: rand() > 0.2,
    weight: rand() > 0.5 ? 1 : 10,
  }));
}

const apply = (items: LayoutItem[]) =>
  solveLayout(items, opts).map((m, i) => ({
    ...items[i],
    box: { ...items[i].box, x: items[i].box.x + m.dx, y: items[i].box.y + m.dy },
  }));

const tooClose = (bs: Box[]) => {
  let n = 0;
  for (let i = 0; i < bs.length; i++)
    for (let j = i + 1; j < bs.length; j++) {
      const [a, b] = [bs[i], bs[j]];
      const m = GAP - 1;
      if (a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m)
        n++;
    }
  return n;
};

describe("solveLayout", () => {
  // Boxes left exactly one gap apart by the x pass used to hide real overlaps from the y pass.
  it.each([3, 5, 9, 11, 42])("clears a crowded board completely (seed %i)", (seed) => {
    const out = apply(crowd(40, seed));
    expect(tooClose(out.map((item) => item.box))).toBe(0);
  });

  it.each([3, 9])("separation alone finds nothing to do on its own output (seed %i)", (seed) => {
    const out = apply(crowd(40, seed).map((item) => ({ ...item, alignable: false })));
    expect(solveLayout(out, opts).every((m) => !m.dx && !m.dy)).toBe(true);
  });

  // A solve can bring a node within snapping range of a row, so tidy repeats it (up to 4 rounds).
  it.each([3, 9])("settles within four rounds with alignment on (seed %i)", (seed) => {
    let items = crowd(40, seed);
    for (let round = 0; round < 4; round++) items = apply(items);
    expect(solveLayout(items, opts).every((m) => !m.dx && !m.dy)).toBe(true);
    expect(tooClose(items.map((item) => item.box))).toBe(0);
  });

  it("leaves an already clear layout exactly where it is", () => {
    const items: LayoutItem[] = [
      { box: { x: 0, y: 0, w: 160, h: 70 }, alignable: true, weight: 1 },
      { box: { x: 400, y: 300, w: 160, h: 70 }, alignable: true, weight: 1 },
    ];
    expect(solveLayout(items, opts)).toEqual([
      { dx: 0, dy: 0, aligned: false },
      { dx: 0, dy: 0, aligned: false },
    ]);
  });

  it("lines up nodes whose centres are close, onto the largest one", () => {
    const items: LayoutItem[] = [
      { box: { x: 0, y: 0, w: 200, h: 100 }, alignable: true, weight: 1 },
      { box: { x: 400, y: 20, w: 160, h: 70 }, alignable: true, weight: 1 },
    ];
    // The big box's centre is y=50; the small one's is 55, so it moves up 5.
    expect(solveLayout(items, opts)[1]).toEqual({ dx: 0, dy: -5, aligned: true });
  });

  it("never lines up notes or groups", () => {
    const items: LayoutItem[] = [
      { box: { x: 0, y: 0, w: 200, h: 100 }, alignable: true, weight: 1 },
      { box: { x: 400, y: 20, w: 160, h: 70 }, alignable: false, weight: 1 },
    ];
    expect(solveLayout(items, opts)[1]).toEqual({ dx: 0, dy: 0, aligned: false });
  });
});
