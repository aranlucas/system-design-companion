import { elementAttribute, requiredElementAttribute } from "#app/shared/element-attributes.ts";
import { requiredPoint } from "#app/shared/schemas.ts";
// Layout problems in a scene, as counts. Shared by the tidy regression tests and scripts/tidy-check.ts.
import type { El } from "#app/shared/protocol.ts";
import type { Scene } from "#app/worker/scene.ts";

type Pt = [number, number];

/** A bound shape (if it still exists) and the arrow end drawn at it. */
type BoundEnd = [El | null | undefined, Pt];

type Segment = [Pt, Pt];

const overlap = (a: El, b: El) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const pairs = <T>(xs: T[], hit: (a: T, b: T) => boolean) => {
  let n = 0;

  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      if (hit(xs[i], xs[j])) {
        n++;
      }
    }
  }

  return n;
};

const distToEl = ([x, y]: Pt, e: El) =>
  Math.hypot(Math.max(e.x - x, 0, x - (e.x + e.width)), Math.max(e.y - y, 0, y - (e.y + e.height)));

/** Do segments p→q and u→v properly intersect? */
const segmentsCross = (p: Pt, q: Pt, u: Pt, v: Pt) => {
  const d = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

  const d1 = d(u, v, p);
  const d2 = d(u, v, q);
  const d3 = d(p, q, u);
  const d4 = d(p, q, v);

  return d1 * d2 < 0 && d3 * d4 < 0;
};

/** Does segment p→q pass through e's interior? Sampled, like a reviewer eyeballing it. */
const passesThrough = (p: Pt, q: Pt, e: El) => {
  for (let i = 1; i < 20; i++) {
    const x = p[0] + ((q[0] - p[0]) * i) / 20;
    const y = p[1] + ((q[1] - p[1]) * i) / 20;

    if (x > e.x && x < e.x + e.width && y > e.y && y < e.y + e.height) {
      return true;
    }
  }

  return false;
};

const path = (a: El): Pt[] =>
  requiredElementAttribute(a, "points").map(([x, y]: Pt) => [a.x + x, a.y + y]);

const segs = (a: El) => {
  const pts = path(a);

  return pts.slice(1).map((p, i): Segment => [pts[i], p]);
};

export function layoutReport(s: Scene) {
  const live = s.live();
  const byId = new Map(live.map((e) => [e.id, e]));
  const blocks = live.filter((e) => s.isNode(e) || s.isNote(e));
  const frames = live.filter((e) => e.type === "frame");
  const arrows = live.filter((e) => e.type === "arrow");
  const nodes = live.filter((e) => s.isNode(e));

  const outsideFrame = blocks.filter((e) => {
    const f = elementAttribute(e, "frameId")
      ? byId.get(requiredElementAttribute(e, "frameId"))
      : undefined;

    return (
      f &&
      !(
        e.x >= f.x &&
        e.y >= f.y &&
        e.x + e.width <= f.x + f.width &&
        e.y + e.height <= f.y + f.height
      )
    );
  }).length;

  // Bound arrows whose drawn ends are detached (>20px) from the shapes they are bound to.
  const brokenArrows = arrows.filter((a) => {
    const pts = path(a);

    const ends: BoundEnd[] = [
      [
        elementAttribute(a, "startBinding") &&
          byId.get(requiredElementAttribute(a, "startBinding").elementId),
        pts[0],
      ],
      [
        elementAttribute(a, "endBinding") &&
          byId.get(requiredElementAttribute(a, "endBinding").elementId),
        requiredPoint(pts, -1),
      ],
    ];

    return ends.some(([n, p]) => n && distToEl(p, n) > 20);
  }).length;

  // Arrows passing through a node that is not one of their ends.
  const crossings = arrows.filter((a) => {
    const ends = new Set([
      elementAttribute(a, "startBinding")?.elementId,
      elementAttribute(a, "endBinding")?.elementId,
    ]);

    const pts = path(a);
    const others = nodes.filter((n) => !ends.has(n.id));

    return pts.some((p, i) => i > 0 && others.some((n) => passesThrough(pts[i - 1], p, n)));
  }).length;

  // What a reader sees as clutter: bound arrows crossing each other, running through a caption or
  // note, drawn at an angle, and labels landing on shapes, captions, notes or each other.
  const bound = arrows.filter(
    (a) => elementAttribute(a, "startBinding") && elementAttribute(a, "endBinding"),
  );

  let arrowCrossings = 0;

  for (let i = 0; i < bound.length; i++) {
    for (let j = i + 1; j < bound.length; j++) {
      arrowCrossings += segs(bound[i]).reduce(
        (count, [p, q]) =>
          count + segs(bound[j]).filter(([u, v]) => segmentsCross(p, q, u, v)).length,
        0,
      );
    }
  }

  const captions = live.filter((e) => elementAttribute(e, "customData")?.componentLabel);
  const texts = [...captions, ...live.filter((e) => s.isNote(e))];

  const throughText = bound.filter((a) =>
    segs(a).some(([p, q]) => texts.some((t) => passesThrough(p, q, t))),
  ).length;

  const diagonal = bound.reduce(
    (n, a) => n + segs(a).filter(([p, q]) => p[0] !== q[0] && p[1] !== q[1]).length,
    0,
  );

  const arrowLabels = live.filter((e) => {
    const c = elementAttribute(e, "containerId")
      ? byId.get(requiredElementAttribute(e, "containerId"))
      : undefined;

    return e.type === "text" && c?.type === "arrow";
  });

  const labelClashes =
    pairs(arrowLabels, overlap) +
    arrowLabels.reduce((n, l) => n + [...nodes, ...texts].filter((o) => overlap(l, o)).length, 0);

  const notes = blocks.filter((e) => e.type === "text");

  return {
    arrowCrossings,
    throughText,
    diagonal,
    labelClashes,
    brokenArrows,
    crossings,
    blockOverlaps: pairs(blocks, overlap),
    frameOverlaps: pairs(frames, overlap),
    loose: blocks.filter((e) => !elementAttribute(e, "frameId")).length,
    outsideFrame,
    widestNote: notes.length ? Math.max(...notes.map((e) => e.width)) : 0,
  };
}
