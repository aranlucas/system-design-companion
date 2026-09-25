// Orthogonal connector routing: right-angle routes that go around boxes, cross each other as
// little as possible, and leave room for their labels. Arrows are routed one at a time (shortest
// first) with A* over a sparse grid built from obstacle edges and the channels between them.

export type Box = { x: number; y: number; w: number; h: number };
export type Pt = { x: number; y: number };
export type Side = "top" | "right" | "bottom" | "left";

export interface RouteRequest {
  id: string;
  from: Box;
  to: Box;
  /** Size of the arrow's label, if it has one. */
  label?: Size;
}

export interface Route {
  /** Absolute points, first on `from`'s side and last on `to`'s, every segment axis-aligned. */
  points: Pt[];
  startSide: Side;
  endSide: Side;
  /** Where the label's centre goes, as a fraction of the route's length. */
  labelAt?: number;
  /** No clear route existed; this is a plain elbow that may cross things. */
  fallback?: boolean;
}

export interface RouteOptions {
  /** Routes stay inside this box (a frame), when given. */
  bounds?: Box;
  /** Clearance kept around obstacles. */
  margin?: number;
  /** Distance between an arrow end and its shape (Excalidraw's binding gap). */
  gap?: number;
  /** Other arrows that stay put; new routes avoid crossing or running along them. */
  fixed?: Pt[][];
}

const BEND = 40;
const CROSS = 240;
const SHARE = 4; // per px of running on top of another route
const SIDE_REUSE = 30;
const TWIN_REUSE = 150;
const OFF_CENTRE = 12;
const REACH = 400;

const DIRS: Pt[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];
const SIDES: Side[] = ["top", "right", "bottom", "left"];

const inside = (p: Pt, b: Box) => p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h;
const grow = (b: Box, m: number): Box => ({
  x: b.x - m,
  y: b.y - m,
  w: b.w + 2 * m,
  h: b.h + 2 * m,
});

/** Does the axis-aligned segment a→b pass through the interior of box o? */
function segmentBlocked(a: Pt, b: Pt, o: Box) {
  if (a.y === b.y) {
    const [x0, x1] = a.x < b.x ? [a.x, b.x] : [b.x, a.x];
    return a.y > o.y && a.y < o.y + o.h && x1 > o.x && x0 < o.x + o.w;
  }
  const [y0, y1] = a.y < b.y ? [a.y, b.y] : [b.y, a.y];
  return a.x > o.x && a.x < o.x + o.w && y1 > o.y && y0 < o.y + o.h;
}

type Seg = { a: Pt; b: Pt };
type Size = { w: number; h: number };
/** A point just outside one side of a box, and the direction (index into DIRS) pointing away. */
type Port = { p: Pt; dir: number };
/** A port on a given side, `along` px off the side's middle. */
type SidePort = Port & { side: Side; along: number };
/** A route found by the search, or a plain elbow when none was. */
type Found = { points: Pt[]; start: SidePort; end: SidePort; found: boolean };
/** A search state: a grid vertex reached heading in `dir`, at cost `g`. */
type SearchNode = {
  v: number;
  dir: number;
  g: number;
  prev: SearchNode | null;
  p: Pt;
  start: SidePort;
};
type HeapItem<T> = { f: number; v: T };
type LabelSpot = { t: number; box: Box };
type ScoredSpot = LabelSpot & { score: number };
type SideCost = (b: Box, port: SidePort) => number;
/** The search reached a lead-out point it can finish from, through this end port. */
type Arrival = { node: SearchNode; end: SidePort };

const segments = (pts: Pt[]): Seg[] => pts.slice(1).map((b, i) => ({ a: pts[i], b }));

/** Do two axis-aligned segments cross at a point interior to both? */
function crosses(s: Seg, t: Seg) {
  const sh = s.a.y === s.b.y;
  const th = t.a.y === t.b.y;
  if (sh === th) return false;
  const [h, v] = sh ? [s, t] : [t, s];
  const hx0 = Math.min(h.a.x, h.b.x),
    hx1 = Math.max(h.a.x, h.b.x);
  const vy0 = Math.min(v.a.y, v.b.y),
    vy1 = Math.max(v.a.y, v.b.y);
  return v.a.x > hx0 && v.a.x < hx1 && h.a.y > vy0 && h.a.y < vy1;
}

/** Length along which two axis-aligned segments run on top of each other (within 4px). */
function shared(s: Seg, t: Seg) {
  const sh = s.a.y === s.b.y;
  if (sh !== (t.a.y === t.b.y)) return 0;
  if (sh) {
    if (Math.abs(s.a.y - t.a.y) > 4) return 0;
    const lo = Math.max(Math.min(s.a.x, s.b.x), Math.min(t.a.x, t.b.x));
    const hi = Math.min(Math.max(s.a.x, s.b.x), Math.max(t.a.x, t.b.x));
    return Math.max(0, hi - lo);
  }
  if (Math.abs(s.a.x - t.a.x) > 4) return 0;
  const lo = Math.max(Math.min(s.a.y, s.b.y), Math.min(t.a.y, t.b.y));
  const hi = Math.min(Math.max(s.a.y, s.b.y), Math.max(t.a.y, t.b.y));
  return Math.max(0, hi - lo);
}

/** A point `d` px out from the middle of a box's side, plus the outward direction index. */
function port(b: Box, side: Side, d: number, along = 0): Port {
  const cx = Math.round(b.x + b.w / 2 + along);
  const cy = Math.round(b.y + b.h / 2 + along);
  switch (side) {
    case "top":
      return { p: { x: cx, y: Math.round(b.y - d) }, dir: 0 };
    case "right":
      return { p: { x: Math.round(b.x + b.w + d), y: cy }, dir: 1 };
    case "bottom":
      return { p: { x: cx, y: Math.round(b.y + b.h + d) }, dir: 2 };
    case "left":
      return { p: { x: Math.round(b.x - d), y: cy }, dir: 3 };
  }
}

/**
 * Where an arrow may leave or enter a box: the middle of each side, and on sides long enough,
 * a point either side of the middle, so parallel arrows can run side by side.
 */
function sidePorts(b: Box, other: Box, gap: number): SidePort[] {
  return SIDES.flatMap((side) => {
    const across = side === "top" || side === "bottom";
    const length = across ? b.w : b.h;
    const off = Math.min(24, Math.floor(length * 0.3));
    const alongs = off >= 8 ? [0, -off, off] : [0];
    // Lined up with the other shape's centre, when that's on this side: a straight connection
    // between two shapes a few px off-centre, instead of a pair of bends.
    const centre = across
      ? other.x + other.w / 2 - (b.x + b.w / 2)
      : other.y + other.h / 2 - (b.y + b.h / 2);
    const lined = Math.round(centre);
    if (Math.abs(lined) <= length / 2 - 8 && !alongs.includes(lined)) alongs.push(lined);
    return alongs.map((along) => ({ side, along, ...port(b, side, gap, along) }));
  });
}

/** Binary min-heap keyed by f. */
class Heap<T> {
  private items: HeapItem<T>[] = [];
  get size() {
    return this.items.length;
  }
  push(f: number, v: T) {
    const a = this.items;
    a.push({ f, v });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): T {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top.v;
  }
}

const uniq = (xs: number[]) => [...new Set(xs.map(Math.round))].sort((a, b) => a - b);

/** Remove points that don't turn, so every point is an end or a bend. */
function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    if (out.length && out.at(-1)!.x === p.x && out.at(-1)!.y === p.y) continue;
    if (out.length >= 2) {
      const a = out.at(-2)!,
        b = out.at(-1)!;
      if ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)) out.pop();
    }
    out.push(p);
  }
  return out;
}

const length = (pts: Pt[]) =>
  pts.slice(1).reduce((s, p, i) => s + Math.abs(p.x - pts[i].x) + Math.abs(p.y - pts[i].y), 0);

/** The point at `t` (0–1) of the way along a polyline, by length. */
export function pointAt(pts: Pt[], t: number): Pt {
  let left = length(pts) * t;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1],
      b = pts[i];
    const l = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (left <= l || i === pts.length - 1) {
      const f = l ? Math.min(left / l, 1) : 0;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    left -= l;
  }
  return pts[0];
}

export function routeOrthogonal(
  requests: RouteRequest[],
  obstacles: Box[],
  opts: RouteOptions = {},
): Map<string, Route> {
  const margin = opts.margin ?? 16;
  const gap = opts.gap ?? 6;
  const lead = margin + 8; // the straight stretch out of a side before the first bend
  const blocks = obstacles.map((o) => grow(o, margin));
  const bounds = opts.bounds && grow(opts.bounds, -12);
  const fixedSegs: Seg[] = (opts.fixed ?? []).flatMap((pts) =>
    segments(pts).filter((sg) => sg.a.x === sg.b.x || sg.a.y === sg.b.y),
  );
  const inBounds = (p: Pt) =>
    !bounds ||
    (p.x >= bounds.x &&
      p.x <= bounds.x + bounds.w &&
      p.y >= bounds.y &&
      p.y <= bounds.y + bounds.h);

  const order = [...requests].sort((a, b) => {
    const d = (r: RouteRequest) =>
      Math.abs(r.from.x + r.from.w / 2 - r.to.x - r.to.w / 2) +
      Math.abs(r.from.y + r.from.h / 2 - r.to.y - r.to.h / 2);
    return d(a) - d(b) || (a.id < b.id ? -1 : 1);
  });

  const grids = new Map<string, Uint8Array>();
  const state = new Map<string, Found>();
  const key = (b: Box, s: Side, along = 0) => `${b.x},${b.y},${b.w},${b.h}:${s}:${along}`;
  const pair = (r: RouteRequest) => [key(r.from, "top"), key(r.to, "top")].sort().join("|");
  const context = (req: RouteRequest) => {
    const segs = [...fixedSegs];
    const sides = new Map<string, number>();
    const twins = new Set<string>();
    for (const r of order) {
      const f = state.get(r.id);
      if (!f || r.id === req.id) continue;
      segs.push(...segments(f.points));
      for (const k of [
        key(r.from, f.start.side, f.start.along),
        key(r.to, f.end.side, f.end.along),
      ]) {
        sides.set(k, (sides.get(k) ?? 0) + 1);
        if (pair(r) === pair(req)) twins.add(k);
      }
    }
    return { segs, sides, twins };
  };
  const route = (req: RouteRequest) => {
    const { segs, sides, twins } = context(req);
    // Another arrow between the same two shapes on the same side would leave no room for either
    // label, so that costs far more than sharing a side with an unrelated arrow.
    const cost = (b: Box, p: SidePort) => {
      const k = key(b, p.side, p.along);
      return (
        (sides.get(k) ?? 0) * SIDE_REUSE +
        (twins.has(k) ? TWIN_REUSE : 0) +
        (p.along ? OFF_CENTRE : 0)
      );
    };
    // Search near the two shapes first; almost every good route stays there.
    const near = routeOne(req, segs, cost, REACH);
    return near.found ? near : routeOne(req, segs, cost, null);
  };

  // Route shortest first, then rip up and reroute each against all the others until stable:
  // the first pass lets early routes take paths that later ones must then cross.
  for (const req of order) state.set(req.id, route(req));
  for (let round = 0; round < 3; round++) {
    let moved = false;
    for (const req of order) {
      const next = route(req);
      if (JSON.stringify(next.points) !== JSON.stringify(state.get(req.id)!.points)) {
        state.set(req.id, next);
        moved = true;
      }
    }
    if (!moved) break;
  }

  // Labels last, once every route is final.
  const all = [...fixedSegs, ...order.flatMap((r) => segments(state.get(r.id)!.points))];
  const labels: Box[] = [];
  const out = new Map<string, Route>();
  for (const req of order) {
    const f = state.get(req.id)!;
    const r: Route = {
      points: f.points,
      startSide: f.start.side,
      endSide: f.end.side,
      ...(f.found ? {} : { fallback: true }),
    };
    if (req.label) {
      const at = placeLabel(f.points, req.label, [...obstacles, ...labels], all, req.from, req.to);
      r.labelAt = at.t;
      labels.push(at.box);
    }
    out.set(req.id, r);
  }
  return out;

  function routeOne(
    req: RouteRequest,
    routed: Seg[],
    sideCost: SideCost,
    reach: number | null,
  ): Found {
    // The search area: around both shapes, or everywhere.
    const region =
      reach === null
        ? null
        : grow(
            {
              x: Math.min(req.from.x, req.to.x),
              y: Math.min(req.from.y, req.to.y),
              w:
                Math.max(req.from.x + req.from.w, req.to.x + req.to.w) -
                Math.min(req.from.x, req.to.x),
              h:
                Math.max(req.from.y + req.from.h, req.to.y + req.to.h) -
                Math.min(req.from.y, req.to.y),
            },
            reach,
          );
    const within = (p: Pt) =>
      !region ||
      (p.x >= region.x &&
        p.x <= region.x + region.w &&
        p.y >= region.y &&
        p.y <= region.y + region.h);
    const touches = (b: Box) =>
      !region ||
      (b.x < region.x + region.w &&
        region.x < b.x + b.w &&
        b.y < region.y + region.h &&
        region.y < b.y + b.h);
    // Obstacles for this route: everything except its own two shapes (their sides are exits).
    const own = [grow(req.from, margin), grow(req.to, margin)];
    const others = blocks.filter(
      (b) =>
        touches(b) && !own.some((o) => o.x === b.x && o.y === b.y && o.w === b.w && o.h === b.h),
    );
    const starts = sidePorts(req.from, req.to, gap);
    const ends = sidePorts(req.to, req.from, gap);
    const leadOut = (p: Pt, dir: number) => ({
      x: p.x + DIRS[dir].x * (lead - gap),
      y: p.y + DIRS[dir].y * (lead - gap),
    });

    const edges = [...others, ...own];
    const xs = uniq([
      ...edges.flatMap((b) => [b.x, b.x + b.w]),
      ...starts.map((s) => leadOut(s.p, s.dir).x),
      ...ends.map((e) => leadOut(e.p, e.dir).x),
      ...(bounds ? [bounds.x, bounds.x + bounds.w] : []),
    ]);
    const ys = uniq([
      ...edges.flatMap((b) => [b.y, b.y + b.h]),
      ...starts.map((s) => leadOut(s.p, s.dir).y),
      ...ends.map((e) => leadOut(e.p, e.dir).y),
      ...(bounds ? [bounds.y, bounds.y + bounds.h] : []),
    ]);
    // Channel centres: routes through a gap between shapes run down its middle.
    const mids = (vs: number[]) => vs.slice(1).map((v, i) => Math.round((v + vs[i]) / 2));
    const gx = uniq([...xs, ...mids(xs)]);
    const gy = uniq([...ys, ...mids(ys)]);
    const xi = new Map(gx.map((v, i) => [v, i]));
    const yi = new Map(gy.map((v, i) => [v, i]));
    const free = (p: Pt) => inBounds(p) && within(p) && !edges.some((b) => inside(p, b));
    // Which vertices are free and which unit moves are clear depend only on this route's shapes,
    // not on the other routes, so they're computed once and reused across reroute rounds.
    const W0 = gx.length;
    const H0 = gy.length;
    const gridKey = `${req.id}:${reach}`;
    let open = grids.get(gridKey);
    if (!open) {
      const freeV = new Uint8Array(W0 * H0);
      for (let j = 0; j < H0; j++)
        for (let i = 0; i < W0; i++) freeV[j * W0 + i] = free({ x: gx[i], y: gy[j] }) ? 1 : 0;
      open = new Uint8Array(W0 * H0 * 4);
      for (let j = 0; j < H0; j++)
        for (let i = 0; i < W0; i++) {
          if (!freeV[j * W0 + i]) continue;
          const a = { x: gx[i], y: gy[j] };
          for (let d = 0; d < 4; d++) {
            const ii = i + DIRS[d].x,
              jj = j + DIRS[d].y;
            if (ii < 0 || jj < 0 || ii >= W0 || jj >= H0 || !freeV[jj * W0 + ii]) continue;
            const b = { x: gx[ii], y: gy[jj] };
            if (!edges.some((o) => segmentBlocked(a, b, o))) open[(j * W0 + i) * 4 + d] = 1;
          }
        }
      grids.set(gridKey, open);
    }
    const grid = open;
    // The stub between a side and its lead-out point crosses its own shape's clearance by design.
    const stubClear = (a: Pt, b: Pt) => !others.some((o) => segmentBlocked(a, b, o));

    const goal = new Map<number, SidePort>();
    const W = gx.length;
    const id = (x: number, y: number) => yi.get(y)! * W + xi.get(x)!;
    for (const e of ends) {
      const q = leadOut(e.p, e.dir);
      if (!free(q)) continue;
      // Arriving means travelling opposite to the side's outward direction.
      goal.set(id(q.x, q.y) * 4 + ((e.dir + 2) % 4), e);
    }
    const hs = routed.filter((t) => t.a.y === t.b.y);
    const vs = routed.filter((t) => t.a.x === t.b.x && t.a.y !== t.b.y);
    const segCost = (a: Pt, b: Pt) => {
      const s = { a, b };
      let c = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      const [across, along] = a.y === b.y ? [vs, hs] : [hs, vs];
      for (const t of across) if (crosses(s, t)) c += CROSS;
      for (const t of along) c += shared(s, t) * SHARE;
      return c;
    };

    const heap = new Heap<SearchNode>();
    const best = new Float64Array(gx.length * gy.length * 4).fill(Infinity);
    const target = { x: req.to.x + req.to.w / 2, y: req.to.y + req.to.h / 2 };
    const h = (p: Pt) => Math.abs(p.x - target.x) + Math.abs(p.y - target.y);
    for (const s of starts) {
      const q = leadOut(s.p, s.dir);
      if (!free(q) || !stubClear(s.p, q)) continue;
      const g = segCost(s.p, q) + sideCost(req.from, s);
      const root: SearchNode = { v: -1, dir: s.dir, g: 0, prev: null, p: s.p, start: s };
      const n: SearchNode = { v: id(q.x, q.y), dir: s.dir, g, prev: root, p: q, start: s };
      heap.push(g + h(q), n);
    }
    let found: Arrival | null = null;
    let expanded = 0;
    while (heap.size && expanded < 60000) {
      const n = heap.pop();
      const k = n.v * 4 + n.dir;
      if (best[k] <= n.g) continue;
      best[k] = n.g;
      expanded++;
      const done = goal.get(k);
      if (done && stubClear(n.p, done.p)) {
        found = { node: n, end: done };
        break;
      }
      for (let d = 0; d < 4; d++) {
        if (d === (n.dir + 2) % 4) continue; // no U-turns
        if (!grid[n.v * 4 + d]) continue;
        const i = (n.v % W) + DIRS[d].x;
        const j = Math.floor(n.v / W) + DIRS[d].y;
        const q = { x: gx[i], y: gy[j] };
        const g = n.g + segCost(n.p, q) + (d === n.dir ? 0 : BEND);
        const next: SearchNode = {
          v: id(q.x, q.y),
          dir: d,
          g,
          prev: n,
          p: q,
          start: n.start,
        };
        if (best[next.v * 4 + d] <= g) continue;
        const endBonus = goal.get(next.v * 4 + d) ? sideCost(req.to, goal.get(next.v * 4 + d)!) : 0;
        heap.push(g + endBonus + h(q), next);
      }
    }

    let points: Pt[];
    let start: SidePort, end: SidePort;
    if (found) {
      const path: Pt[] = [found.end.p];
      for (let n: SearchNode | null = found.node; n; n = n.prev) path.push(n.p);
      points = simplify(path.toReversed());
      start = found.node.start;
      end = found.end;
    } else {
      // Nowhere clear to go: a plain elbow between facing sides.
      const dx = req.to.x + req.to.w / 2 - (req.from.x + req.from.w / 2);
      const dy = req.to.y + req.to.h / 2 - (req.from.y + req.from.h / 2);
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      const startSide = horizontal ? (dx > 0 ? "right" : "left") : dy > 0 ? "bottom" : "top";
      const endSide = horizontal ? (dx > 0 ? "left" : "right") : dy > 0 ? "top" : "bottom";
      start = { side: startSide, along: 0, ...port(req.from, startSide, gap) };
      end = { side: endSide, along: 0, ...port(req.to, endSide, gap) };
      const a = start.p;
      const b = end.p;
      const m = horizontal
        ? [
            { x: Math.round((a.x + b.x) / 2), y: a.y },
            { x: Math.round((a.x + b.x) / 2), y: b.y },
          ]
        : [
            { x: a.x, y: Math.round((a.y + b.y) / 2) },
            { x: b.x, y: Math.round((a.y + b.y) / 2) },
          ];
      points = simplify([a, ...m, b]);
    }
    return { points, start, end, found: !!found };
  }
}

/**
 * The clearest spot along a route for its label: on a segment long enough to hold it, away from
 * shapes, other labels and other routes, preferring horizontal runs near the middle.
 */
function placeLabel(
  pts: Pt[],
  size: Size,
  avoid: Box[],
  routes: Seg[],
  from: Box,
  to: Box,
): LabelSpot {
  const total = length(pts) || 1;
  const own = new Set(pts.slice(1).map((p, i) => `${pts[i].x},${pts[i].y},${p.x},${p.y}`));
  const mine = (s: Seg) => own.has(`${s.a.x},${s.a.y},${s.b.x},${s.b.y}`);
  const hits = (b: Box, o: Box) =>
    b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h;
  let best: ScoredSpot | null = null;
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1],
      b = pts[i];
    const l = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    const horizontal = a.y === b.y;
    const need = (horizontal ? size.w : size.h) + 8;
    const steps = Math.max(1, Math.floor(l / 12));
    for (let k = 0; k <= steps; k++) {
      const f = k / steps;
      const c = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      const box = {
        x: c.x - size.w / 2 - 4,
        y: c.y - size.h / 2 - 2,
        w: size.w + 8,
        h: size.h + 4,
      };
      const t = (walked + l * f) / total;
      let score = Math.abs(t - 0.5) * 200;
      if (l < need) score += 400;
      if (!horizontal) score += 120;
      for (const o of [...avoid, from, to]) if (hits(box, o)) score += 1000;
      for (const s of routes) {
        if (mine(s)) continue;
        const sb = {
          x: Math.min(s.a.x, s.b.x),
          y: Math.min(s.a.y, s.b.y),
          w: Math.abs(s.b.x - s.a.x) || 1,
          h: Math.abs(s.b.y - s.a.y) || 1,
        };
        if (hits(box, sb)) score += 300;
      }
      if (!best || score < best.score) best = { t, box, score };
    }
    walked += l;
  }
  return best ? { t: best.t, box: best.box } : { t: 0.5, box: { x: 0, y: 0, w: 0, h: 0 } };
}
