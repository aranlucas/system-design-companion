// Overlap removal and alignment as one least-squares problem, solved with VPSC (Dwyer, Marriott &
// Stuckey, "Fast node overlap removal"), the solver behind WebCola. Deep imports keep WebCola's
// d3 adaptors out of the Worker bundle.
import {
  generateXConstraints,
  generateYConstraints,
  Rectangle,
} from "webcola/dist/src/rectangle.js";
import { Constraint, Solver, Variable } from "webcola/dist/src/vpsc.js";

export type Box = { x: number; y: number; w: number; h: number };

export interface LayoutItem {
  box: Box;
  /** Nodes can be aligned into rows and columns; notes and groups only avoid overlaps. */
  alignable: boolean;
  /** How strongly the item stays where it is: untouched items outweigh ones just added. */
  weight: number;
}

export interface SolveOptions {
  /** Minimum clear space between any two items. */
  gap: number;
  /** How close two centres must be to line up. */
  alignTolerance: number;
}

export interface LayoutMove {
  dx: number;
  dy: number;
  /** Moved only to line up with its row or column. */
  aligned: boolean;
}

type Axis = "x" | "y";
const size = (axis: Axis) => (axis === "x" ? "w" : "h");
const mid = (b: Box, axis: Axis) => b[axis] + b[size(axis)] / 2;

/** Groups of items whose centres lie within `tol` of each other along `axis`. */
function clusters(ids: number[], key: (i: number) => number, tol: number): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  for (const i of ids.toSorted((a, b) => key(a) - key(b))) {
    if (cur.length && key(i) - key(cur[0]) > tol) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
    cur.push(i);
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/**
 * Where each item should line up: nodes whose centres are within `tol` along an axis share the
 * centre of the largest one (a fixed anchor, so repeated runs converge).
 */
function alignmentTargets(items: LayoutItem[], tol: number) {
  const target = items.map((it) => ({ x: it.box.x, y: it.box.y }));
  const groups: Record<Axis, number[][]> = { x: [], y: [] };
  const ids = items.flatMap((it, i) => (it.alignable ? [i] : []));
  for (const axis of ["x", "y"] as const) {
    for (const group of clusters(ids, (i) => mid(items[i].box, axis), tol)) {
      const area = (i: number) => items[i].box.w * items[i].box.h;
      const anchor = group.reduce((m, i) => (area(i) > area(m) ? i : m));
      const centre = mid(items[anchor].box, axis);
      for (const i of group) target[i][axis] = centre - items[i].box[size(axis)] / 2;
      groups[axis].push(group);
    }
  }
  return { target, groups };
}

/**
 * One axis of the projection. Unknowns are shifts from each item's current position, so a layout
 * that already satisfies everything solves to zero. Required gaps are rounded up and the result
 * floored, which keeps every separation after rounding (floor(a + k) = floor(a) + k for integer k):
 * a second pass finds nothing to fix.
 */
function solveAxis(
  items: LayoutItem[],
  boxes: Box[],
  desired: number[],
  axis: Axis,
  gap: number,
  equal: number[][],
  /** Rows (for x) or columns (for y): their members can only be separated along this axis. */
  lines: number[][],
): number[] {
  // Padded to just under half the gap: boxes already exactly `gap` apart must not touch, or the
  // scanline takes the touching box as a neighbour and never links past it to a real overlap.
  const half = (gap - 0.5) / 2;
  const rects = boxes.map(
    (b) => new Rectangle(b.x - half, b.x + b.w + half, b.y - half, b.y + b.h + half),
  );
  const vars = items.map((it, i) => new Variable(desired[i], it.weight));
  const generate = axis === "x" ? generateXConstraints : generateYConstraints;
  const separate = (l: number, r: number) =>
    new Constraint(
      vars[l],
      vars[r],
      Math.ceil(boxes[l][axis] + boxes[l][size(axis)] + gap - boxes[r][axis] - 1e-6),
    );
  const cs = generate(rects, vars).map((c) =>
    separate(vars.indexOf(c.left), vars.indexOf(c.right)),
  );
  for (const line of lines) {
    const order = line.toSorted((a, b) => mid(boxes[a], axis) - mid(boxes[b], axis));
    for (let k = 1; k < order.length; k++) cs.push(separate(order[k - 1], order[k]));
  }
  for (const group of equal) {
    const [a, ...rest] = group;
    for (const b of rest) cs.push(new Constraint(vars[a], vars[b], desired[b] - desired[a], true));
  }
  new Solver(vars, cs).solve();
  return vars.map((v) => Math.floor(v.position() + 1e-6));
}

const overlapping = (a: Box, b: Box, m: number) =>
  a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

/**
 * Line nodes up and keep every pair at least `gap` apart, moving items as little as possible
 * in total (weighted squared distance). Items keep their left-right and above-below order.
 */
export function solveLayout(items: LayoutItem[], opts: SolveOptions): LayoutMove[] {
  const attempt = (align: boolean) => {
    const { target, groups } = align
      ? alignmentTargets(items, opts.alignTolerance)
      : { target: items.map((it) => ({ x: it.box.x, y: it.box.y })), groups: { x: [], y: [] } };
    // Constraints are generated against where alignment wants things, so a snap can't land an
    // item on something the other axis never saw.
    let boxes = items.map((it, i) => ({ ...it.box, y: target[i].y }));
    const dx = solveAxis(
      items,
      boxes,
      target.map((t, i) => Math.round(t.x - items[i].box.x)),
      "x",
      opts.gap,
      groups.x,
      groups.y,
    );
    boxes = items.map((it, i) => ({ ...it.box, x: it.box.x + dx[i] }));
    const dy = solveAxis(
      items,
      boxes,
      target.map((t, i) => Math.round(t.y - items[i].box.y)),
      "y",
      opts.gap,
      groups.y,
      groups.x,
    );
    const moved = items.map((it, i) => ({ ...it.box, x: it.box.x + dx[i], y: it.box.y + dy[i] }));
    let clear = true;
    for (let i = 0; i < moved.length && clear; i++)
      for (let j = i + 1; j < moved.length && clear; j++)
        if (overlapping(moved[i], moved[j], opts.gap - 1)) clear = false;
    const moves = items.map((it, i) => {
      const wanted = {
        x: Math.round(target[i].x - it.box.x),
        y: Math.round(target[i].y - it.box.y),
      };
      const aligned =
        (wanted.x !== 0 || wanted.y !== 0) && dx[i] === wanted.x && dy[i] === wanted.y;
      return { dx: dx[i], dy: dy[i], aligned };
    });
    return { moves, clear };
  };
  // Alignment and separation can conflict (a row that can only be separated vertically); then
  // separation wins and nothing is aligned.
  try {
    const aligned = attempt(true);
    if (aligned.clear) return aligned.moves;
  } catch {
    // unsatisfiable equalities: fall through to separation alone
  }
  return attempt(false).moves;
}
