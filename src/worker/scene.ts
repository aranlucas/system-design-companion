// Scene engine: semantic ops ⇄ Excalidraw elements. Pure logic, no Workers APIs.
import dagre from "@dagrejs/dagre";
import { generateKeyBetween } from "fractional-indexing";
import { componentByKind } from "../shared/components.ts";
import { AGENT_STROKE, type El } from "../shared/protocol.ts";

export type Author = "agent" | "human" | "template";

export const COLORS: Record<string, string> = {
  white: "#ffffff",
  gray: "#e9ecef",
  red: "#ffc9c9",
  pink: "#fcc2d7",
  violet: "#d0bfff",
  blue: "#a5d8ff",
  cyan: "#99e9f2",
  green: "#b2f2bb",
  yellow: "#ffec99",
  orange: "#ffd8a8",
};
const COLOR_NAMES = Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [v, k]));

export const SHAPES = ["rectangle", "ellipse", "diamond"] as const;
export type Shape = (typeof SHAPES)[number];

export interface Placement {
  right_of?: string;
  left_of?: string;
  below?: string;
  above?: string;
  near?: string;
  at?: { x: number; y: number };
  gap?: number;
}

export type Op =
  | {
      op: "add_node";
      ref?: string;
      kind?: string;
      label?: string;
      shape?: Shape;
      color?: string;
      width?: number;
      height?: number;
      place?: Placement;
      frame?: string;
    }
  | {
      op: "connect";
      from: string;
      to: string;
      label?: string;
      dashed?: boolean;
      bidirectional?: boolean;
    }
  | { op: "disconnect"; from: string; to: string }
  | {
      op: "update";
      target: string;
      label?: string;
      color?: string;
      shape?: Shape;
      dashed?: boolean;
      width?: number;
      height?: number;
      move?: Placement;
      frame?: string | null;
    }
  | { op: "remove"; target: string }
  | {
      op: "add_frame";
      ref?: string;
      name: string;
      contains?: string[];
      place?: Placement;
      width?: number;
      height?: number;
    }
  | {
      op: "add_note";
      ref?: string;
      text: string;
      place?: Placement;
      frame?: string;
      size?: "s" | "m" | "l";
    };

export interface OpResult {
  i: number;
  op: string;
  ok: boolean;
  id?: string;
  ref?: string;
  error?: string;
}

const FONT_FAMILY = 5; // Excalifont
const LINE_HEIGHT = 1.25;
const CHAR_W = 0.6;
const NODE_MIN_W = 160;
const NODE_MIN_H = 70;
const PAD = 40;
const SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond", "image", "embeddable", "iframe"]);

type Box = { x: number; y: number; w: number; h: number };

const rnd = () => Math.floor(Math.random() * 2 ** 31);
const ID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";
export function newId(): string {
  let s = "";
  for (let i = 0; i < 21; i++) s += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  return s;
}

const NOTE_WRAP = 64; // chars per line for notes the agent writes
const FRAME_GAP = 80;

/** Word-wrap long lines, keeping list markers as a hanging indent. */
export function wrapText(text: string, max = NOTE_WRAP): string {
  return text
    .split("\n")
    .map((line) => {
      if (line.length <= max) return line;
      const lead = line.match(/^\s*(?:[-*•]|\d+[.)])?\s*/)?.[0] ?? "";
      const hang = " ".repeat(lead.length);
      const out: string[] = [];
      let cur = lead;
      let empty = true;
      for (const w of line.slice(lead.length).split(/\s+/).filter(Boolean)) {
        if (!empty && cur.length + 1 + w.length > max) {
          out.push(cur);
          cur = hang + w;
        } else cur = empty ? cur + w : `${cur} ${w}`;
        empty = false;
      }
      out.push(cur);
      return out.join("\n");
    })
    .join("\n");
}

export interface TidyStats {
  bound: number;
  rerouted: number;
  adopted: number;
  wrapped: number;
  aligned: number;
  separated: number;
  framesMoved: number;
}

export function measureText(text: string, fontSize: number) {
  const lines = text.split("\n");
  const longest = Math.max(...lines.map((l) => l.length), 1);
  return {
    width: Math.ceil(longest * fontSize * CHAR_W),
    height: Math.ceil(lines.length * fontSize * LINE_HEIGHT),
  };
}

const boxOf = (e: El): Box => ({ x: e.x, y: e.y, w: e.width, h: e.height });
const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const overlaps = (a: Box, b: Box, m = 20) =>
  a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
const unionBox = (bs: Box[]): Box | null => {
  if (!bs.length) return null;
  const x = Math.min(...bs.map((b) => b.x));
  const y = Math.min(...bs.map((b) => b.y));
  const r = Math.max(...bs.map((b) => b.x + b.w));
  const btm = Math.max(...bs.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: btm - y };
};

/** Point on the border of `b` in the direction of `toward`, pushed out by `gap`. */
/** Point on the outline of a shape (rect, ellipse or diamond) toward `toward`, pushed out by `gap`. */
function borderPoint(b: Box, toward: { x: number; y: number }, gap: number, shape = "rectangle") {
  const c = center(b);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const a = b.w / 2 + gap;
  const bb = b.h / 2 + gap;
  let t: number;
  if (shape === "ellipse") t = 1 / Math.hypot(dx / a, dy / bb);
  else if (shape === "diamond") t = 1 / (Math.abs(dx) / a + Math.abs(dy) / bb);
  else
    t = Math.min(dx !== 0 ? a / Math.abs(dx) : Infinity, dy !== 0 ? bb / Math.abs(dy) : Infinity);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

type Pt = { x: number; y: number };

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = l2
    ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2))
    : 0;
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}

function distToBox(p: Pt, b: Box): number {
  return Math.hypot(
    Math.max(b.x - p.x, 0, p.x - (b.x + b.w)),
    Math.max(b.y - p.y, 0, p.y - (b.y + b.h)),
  );
}

/** Proper intersection of segments ab and cd (touching endpoints don't count). */
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** Does segment p→q pass through box `b` (inflated by m)? Liang–Barsky clip. */
function segmentHitsBox(p: Pt, q: Pt, b: Box, m: number): boolean {
  const [x0, y0, x1, y1] = [b.x - m, b.y - m, b.x + b.w + m, b.y + b.h + m];
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  for (const [pp, qq] of [
    [-dx, p.x - x0],
    [dx, x1 - p.x],
    [-dy, p.y - y0],
    [dy, y1 - p.y],
  ]) {
    if (pp === 0) {
      if (qq < 0) return false;
    } else {
      const r = qq / pp;
      if (pp < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return false;
    }
  }
  return true;
}

export class Scene {
  els: Map<string, El>;
  private changed = new Set<string>();
  private refs = new Map<string, string>();
  private lastPlaced: string | null = null;
  private grownFrames = new Set<string>();

  constructor(elements: Iterable<El>) {
    this.els = new Map([...elements].map((e) => [e.id, e]));
  }

  // ---------- basics ----------

  live(): El[] {
    return [...this.els.values()]
      .filter((e) => !e.isDeleted)
      .sort((a, b) =>
        (a.index ?? "") < (b.index ?? "") ? -1 : (a.index ?? "") > (b.index ?? "") ? 1 : 0,
      );
  }

  changedElements(): El[] {
    this.enforceBindings();
    this.fixLabelOrder();
    return [...this.changed]
      .map((id) => this.els.get(id)!)
      .filter(Boolean)
      .sort((a, b) =>
        (a.index ?? "") < (b.index ?? "") ? -1 : (a.index ?? "") > (b.index ?? "") ? 1 : 0,
      );
  }

  /**
   * Invariant: a bound arrow's geometry is derived from the shapes it is bound to.
   * Re-route every arrow that changed or whose bound shape changed, whatever code path moved things.
   */
  enforceBindings() {
    for (const a of this.live()) {
      if (a.type !== "arrow" || (!a.startBinding && !a.endBinding)) continue;
      const touched =
        this.changed.has(a.id) ||
        (a.startBinding && this.changed.has(a.startBinding.elementId)) ||
        (a.endBinding && this.changed.has(a.endBinding.elementId));
      if (touched) this.routeArrow(a);
    }
  }

  /** Excalidraw invariant: a bound text must sit above its container in z-order. */
  private fixLabelOrder() {
    for (const id of [...this.changed]) {
      const t = this.els.get(id);
      if (!t || t.type !== "text" || !t.containerId || t.isDeleted) continue;
      const c = this.els.get(t.containerId);
      if (c && c.index && t.index && t.index <= c.index)
        this.mutate(t, { index: generateKeyBetween(this.maxIndex(), null) });
    }
  }

  private maxIndex(): string | null {
    let max: string | null = null;
    for (const e of this.els.values())
      if (e.index && (max === null || e.index > max)) max = e.index;
    return max;
  }

  private add(el: El): El {
    el.index = generateKeyBetween(this.maxIndex(), null);
    this.els.set(el.id, el);
    this.changed.add(el.id);
    return el;
  }

  /** Mutate an element and bump its version so it wins reconciliation. */
  mutate(el: El, patch: Partial<El> = {}): El {
    Object.assign(el, patch);
    el.version = (el.version ?? 0) + 1;
    el.versionNonce = rnd();
    el.updated = Date.now();
    this.changed.add(el.id);
    return el;
  }

  private base(type: string, box: Box, author: Author, extra: Partial<El> = {}): El {
    return {
      id: newId(),
      type,
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.w),
      height: Math.round(box.h),
      angle: 0,
      strokeColor: author === "agent" ? AGENT_STROKE : "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: rnd(),
      version: 1,
      versionNonce: rnd(),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
      index: null,
      customData: { author },
      ...extra,
    };
  }

  private textEl(
    text: string,
    box: Box,
    author: Author,
    fontSize: number,
    extra: Partial<El> = {},
  ): El {
    const el = this.base("text", box, author, {
      strokeColor: extra.containerId ? "#1e1e1e" : author === "agent" ? AGENT_STROKE : "#1e1e1e",
      text,
      originalText: text,
      fontSize,
      fontFamily: FONT_FAMILY,
      textAlign: extra.containerId ? "center" : "left",
      verticalAlign: extra.containerId ? "middle" : "top",
      containerId: null,
      autoResize: true,
      lineHeight: LINE_HEIGHT,
      ...extra,
    });
    return el;
  }

  boundText(container: El): El | undefined {
    const ref = (container.boundElements ?? []).find((b: any) => b.type === "text");
    const t = ref ? this.els.get(ref.id) : undefined;
    if (t && !t.isDeleted) return t;
    for (const e of this.els.values())
      if (!e.isDeleted && e.type === "text" && e.containerId === container.id) return e;
    return undefined;
  }

  labelOf(e: El): string {
    if (e.type === "frame" || e.type === "magicframe") return e.name ?? "";
    if (e.type === "text") return e.text ?? "";
    return this.boundText(e)?.text?.replace(/\n/g, " ") ?? "";
  }

  isNode(e: El) {
    return !e.isDeleted && SHAPE_TYPES.has(e.type);
  }

  // ---------- target resolution ----------

  resolve(target: string): El {
    const refId = this.refs.get(target);
    if (refId) return this.els.get(refId)!;
    const byId = this.els.get(target);
    if (byId && !byId.isDeleted) return byId;
    const want = target.trim().toLowerCase();
    const matches = this.live().filter(
      (e) =>
        (this.isNode(e) || e.type === "frame" || (e.type === "text" && !e.containerId)) &&
        this.labelOf(e).trim().toLowerCase() === want,
    );
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(
        `"${target}" is ambiguous (${matches.length} matches: ${matches.map((m) => m.id).join(", ")}); use an id`,
      );
    }
    throw new Error(`no element "${target}" (use an id, a unique label, or a ref from this batch)`);
  }

  private frameOf(target: string | undefined | null): El | null {
    if (!target) return null;
    const f = this.resolve(target);
    if (f.type !== "frame") throw new Error(`"${target}" is not a frame`);
    return f;
  }

  // ---------- placement ----------

  private obstacles(exclude: Set<string>): Box[] {
    return this.live()
      .filter(
        (e) =>
          !exclude.has(e.id) &&
          e.type !== "frame" &&
          e.type !== "arrow" &&
          !(e.type === "text" && e.containerId),
      )
      .map(boxOf);
  }

  sceneBounds(): Box | null {
    return unionBox(
      this.live()
        .filter((e) => e.type !== "arrow")
        .map(boxOf),
    );
  }

  private place(
    spec: Placement | undefined,
    w: number,
    h: number,
    frame: El | null,
    exclude = new Set<string>(),
  ): Box {
    const gap = spec?.gap ?? 100;
    let x: number;
    let y: number;
    let axis: "x" | "y" = "y";
    const anchor = (t: string) => boxOf(this.resolve(t));

    if (spec?.at) {
      ({ x, y } = spec.at);
    } else if (spec?.right_of) {
      const a = anchor(spec.right_of);
      x = a.x + a.w + gap;
      y = a.y + (a.h - h) / 2;
    } else if (spec?.left_of) {
      const a = anchor(spec.left_of);
      x = a.x - gap - w;
      y = a.y + (a.h - h) / 2;
    } else if (spec?.below) {
      const a = anchor(spec.below);
      x = a.x + (a.w - w) / 2;
      y = a.y + a.h + gap;
      axis = "x";
    } else if (spec?.above) {
      const a = anchor(spec.above);
      x = a.x + (a.w - w) / 2;
      y = a.y - gap - h;
      axis = "x";
    } else if (spec?.near) {
      const a = anchor(spec.near);
      const obs = this.obstacles(exclude);
      const candidates: Box[] = [
        { x: a.x + a.w + gap, y: a.y + (a.h - h) / 2, w, h },
        { x: a.x + (a.w - w) / 2, y: a.y + a.h + gap, w, h },
        { x: a.x - gap - w, y: a.y + (a.h - h) / 2, w, h },
        { x: a.x + (a.w - w) / 2, y: a.y - gap - h, w, h },
      ];
      const free = candidates.find((c) => !obs.some((o) => overlaps(c, o)));
      ({ x, y } = free ?? candidates[0]);
    } else if (frame) {
      x = frame.x + PAD;
      y = frame.y + PAD + 20;
      axis = "x";
    } else if (this.lastPlaced && this.els.get(this.lastPlaced)) {
      const a = boxOf(this.els.get(this.lastPlaced)!);
      x = a.x + a.w + gap;
      y = a.y + (a.h - h) / 2;
    } else {
      const b = this.sceneBounds();
      x = b ? b.x + b.w + 150 : 100;
      y = b ? b.y : 100;
    }

    // Nudge off anything we'd overlap; inside a frame wrap onto new rows.
    const obs = this.obstacles(exclude);
    let box = { x, y, w, h };
    for (let i = 0; i < 60 && obs.some((o) => overlaps(box, o)); i++) {
      if (axis === "y") box.y += h + 40;
      else {
        box.x += w + 40;
        if (frame && box.x + w > frame.x + frame.width - PAD) {
          box.x = frame.x + PAD;
          box.y += h + 40;
        }
      }
    }
    return { x: Math.round(box.x), y: Math.round(box.y), w, h };
  }

  /** Grow a frame so it encloses all its children. */
  private fitFrame(frame: El) {
    const kids = this.live()
      .filter((e) => e.frameId === frame.id)
      .map(boxOf);
    const u = unionBox(kids);
    if (!u) return;
    const nx = Math.min(frame.x, u.x - PAD);
    const ny = Math.min(frame.y, u.y - PAD);
    const nr = Math.max(frame.x + frame.width, u.x + u.w + PAD);
    const nb = Math.max(frame.y + frame.height, u.y + u.h + PAD);
    if (
      nx !== frame.x ||
      ny !== frame.y ||
      nr !== frame.x + frame.width ||
      nb !== frame.y + frame.height
    ) {
      this.mutate(frame, { x: nx, y: ny, width: nr - nx, height: nb - ny });
      this.grownFrames.add(frame.id);
    }
  }

  /** Smallest frame containing the centre of `b`. */
  private frameAt(b: Box, exclude?: string): El | null {
    const c = center(b);
    const hits = this.live()
      .filter(
        (f) =>
          f.type === "frame" &&
          f.id !== exclude &&
          c.x >= f.x &&
          c.x <= f.x + f.width &&
          c.y >= f.y &&
          c.y <= f.y + f.height,
      )
      .sort((f1, f2) => f1.width * f1.height - f2.width * f2.height);
    return hits[0] ?? null;
  }

  /** Frame to use for a new element: explicit, else the placement anchor's frame. */
  private impliedFrame(explicit: string | undefined, place: Placement | undefined): El | null {
    if (explicit) return this.frameOf(explicit);
    const anchor = place?.right_of ?? place?.left_of ?? place?.below ?? place?.above ?? place?.near;
    if (!anchor) return null;
    const a = this.resolve(anchor);
    const fid = a.type === "frame" ? a.id : a.frameId;
    return fid ? (this.els.get(fid) ?? null) : null;
  }

  private setFrame(el: El, frame: El | null) {
    if ((el.frameId ?? null) === (frame?.id ?? null)) return;
    this.mutate(el, { frameId: frame?.id ?? null });
    const t = this.boundText(el);
    if (t) this.mutate(t, { frameId: frame?.id ?? null });
  }

  /** Translate a frame together with everything in it, re-routing arrows that leave it. */
  private moveFrameBy(frame: El, dx: number, dy: number) {
    if (!dx && !dy) return;
    const isBoundArrow = (e: El) => e.type === "arrow" && (e.startBinding || e.endBinding);
    const kids = this.live().filter((e) => {
      if (e.frameId !== frame.id || isBoundArrow(e)) return false;
      const c = e.containerId ? this.els.get(e.containerId) : undefined;
      return !(c && isBoundArrow(c)); // arrow labels follow their arrow
    });
    this.mutate(frame, { x: frame.x + dx, y: frame.y + dy });
    for (const k of kids) this.mutate(k, { x: k.x + dx, y: k.y + dy });
    // Bound arrows are re-routed from their shapes by enforceBindings().
  }

  /** Push frames that overlap the `seed` frames out of the way (right or down, whichever is shorter). */
  private separateFrames(seed: Iterable<string>): number {
    const fixed = new Set(seed);
    let moves = 0;
    for (let pass = 0; pass < 30; pass++) {
      const frames = this.live().filter((e) => e.type === "frame");
      let changed = false;
      for (const a of frames) {
        if (!fixed.has(a.id)) continue;
        for (const b of frames) {
          if (b.id === a.id || !overlaps(boxOf(a), boxOf(b), FRAME_GAP / 2 - 1)) continue;
          // Of two seeds, the one later in reading order yields.
          const [anchor, mover] =
            fixed.has(b.id) && (b.y < a.y || (b.y === a.y && b.x < a.x)) ? [b, a] : [a, b];
          const right = anchor.x + anchor.width + FRAME_GAP - mover.x;
          const down = anchor.y + anchor.height + FRAME_GAP - mover.y;
          if (right <= 0 && down <= 0) continue;
          const byRight = right > 0 && (down <= 0 || right <= down);
          this.moveFrameBy(mover, byRight ? right : 0, byRight ? 0 : down);
          fixed.add(mover.id);
          moves++;
          changed = true;
        }
      }
      if (!changed) break;
    }
    return moves;
  }

  // ---------- geometry maintenance ----------

  private centerLabel(container: El) {
    const t = this.boundText(container);
    if (!t) return;
    if (container.type === "arrow") {
      const pts = container.points as [number, number][];
      const mid = (pts.length - 1) / 2;
      const a = pts[Math.floor(mid)];
      const b = pts[Math.ceil(mid)];
      const mx = container.x + (a[0] + b[0]) / 2;
      const my = container.y + (a[1] + b[1]) / 2;
      this.mutate(t, {
        x: Math.round(mx - t.width / 2),
        y: Math.round(my - t.height / 2),
      });
    } else {
      const c = center(boxOf(container));
      this.mutate(t, {
        x: Math.round(c.x - t.width / 2),
        y: Math.round(c.y - t.height / 2),
        frameId: container.frameId ?? null,
      });
    }
  }

  private arrowsBoundTo(id: string): El[] {
    return this.live().filter(
      (e) =>
        (e.type === "arrow" || e.type === "line") &&
        (e.startBinding?.elementId === id || e.endBinding?.elementId === id),
    );
  }

  /**
   * If a bound arrow passes through a box that isn't one of its ends, give it a single bend on the
   * side needing the smallest detour. Only touches straight arrows and bends we added (autoBend);
   * straightens our bend again once the straight path is clear. Returns true if it changed.
   */
  private detour(arrow: El): boolean {
    const pts = arrow.points as [number, number][];
    const ours = arrow.customData?.autoBend === true;
    if (pts.length > 2 && !ours) return false; // a human-shaped curve: leave it alone
    const ends = new Set([arrow.startBinding?.elementId, arrow.endBinding?.elementId]);
    const obstacles = this.live()
      .filter((n) => this.isNode(n) && !ends.has(n.id))
      .map(boxOf);
    const clear = (path: Pt[]) =>
      path.every(
        (p, i) => i === 0 || !obstacles.some((o) => segmentHitsBox(path[i - 1], p, o, 10)),
      );
    const abs = (a: El) =>
      (a.points as [number, number][]).map(([px, py]) => ({ x: a.x + px, y: a.y + py }));
    const setPath = (bend: Pt | null) => {
      const cur = abs(arrow);
      const s0 = cur[0];
      const e0 = cur.at(-1)!;
      const rel = (pt: Pt): [number, number] => [Math.round(pt.x - s0.x), Math.round(pt.y - s0.y)];
      const points = bend ? [rel(s0), rel(bend), rel(e0)] : [rel(s0), rel(e0)];
      this.mutate(arrow, { points, customData: { ...(arrow.customData ?? {}), autoBend: !!bend } });
      this.routeArrow(arrow, false); // recompute the ends toward the bend, keeping the bend fixed
    };

    // Straight path (ends recomputed without any bend).
    const current = abs(arrow);
    const straight = (() => {
      const s = arrow.startBinding && this.els.get(arrow.startBinding.elementId);
      const t = arrow.endBinding && this.els.get(arrow.endBinding.elementId);
      const sc = s ? center(boxOf(s)) : current[0];
      const tc = t ? center(boxOf(t)) : current.at(-1)!;
      return [
        s ? borderPoint(boxOf(s), tc, 8, s.type) : sc,
        t ? borderPoint(boxOf(t), sc, 8, t.type) : tc,
      ];
    })();

    if (clear(straight)) {
      if (pts.length > 2) {
        setPath(null);
        return true;
      }
      return false;
    }
    if (pts.length > 2 && clear(current)) return false; // our bend still works

    // Search perpendicular offsets from the midpoint, nearest first. Ends are re-aimed at the
    // bend (as routeArrow will draw them), so tightly packed neighbours can still be cleared.
    const sEl = arrow.startBinding && this.els.get(arrow.startBinding.elementId);
    const tEl = arrow.endBinding && this.els.get(arrow.endBinding.elementId);
    const aimed = (bend: Pt): Pt[] => [
      sEl ? borderPoint(boxOf(sEl), bend, 8, sEl.type) : straight[0],
      bend,
      tEl ? borderPoint(boxOf(tEl), bend, 8, tEl.type) : straight[1],
    ];
    const [p, q] = straight;
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const nx = -(q.y - p.y) / len;
    const ny = (q.x - p.x) / len;
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    // Other arrows' segments: crossing them costs as much as a 150px longer detour.
    const others: [Pt, Pt][] = [];
    for (const o of this.live()) {
      if (o.type !== "arrow" || o.id === arrow.id) continue;
      const op = abs(o);
      for (let i = 1; i < op.length; i++) others.push([op[i - 1], op[i]]);
    }
    const crossings = (path: Pt[]) => {
      let n = 0;
      for (let i = 1; i < path.length; i++)
        for (const [a, b] of others) if (segmentsCross(path[i - 1], path[i], a, b)) n++;
      return n;
    };
    let best: { bend: Pt; cost: number } | null = null;
    for (let d = 40; d <= 800; d += 20) {
      if (best && d >= best.cost) break; // no farther bend can beat it (cost ≥ d)
      for (const sign of [1, -1]) {
        const bend = { x: mid.x + nx * d * sign, y: mid.y + ny * d * sign };
        const path = aimed(bend);
        if (!clear(path)) continue;
        // Tie-break away from clutter: a bend sitting on another arrow or hugging a box reads badly.
        const cramped =
          others.some(([a, b]) => distToSegment(bend, a, b) < 40) ||
          obstacles.some((o) => distToBox(bend, o) < 40);
        const cost = d + 150 * crossings(path) + (cramped ? 60 : 0);
        if (!best || cost < best.cost) best = { bend, cost };
      }
    }
    if (best) {
      setPath(best.bend);
      return true;
    }
    return false;
  }

  /** Re-derive a bound arrow's geometry from the shapes it is bound to (bends are kept). */
  private routeArrow(arrow: El, shiftBends = true) {
    const pts = arrow.points as [number, number][];
    const absStart = { x: arrow.x + pts[0][0], y: arrow.y + pts[0][1] };
    const absEnd = { x: arrow.x + pts[pts.length - 1][0], y: arrow.y + pts[pts.length - 1][1] };
    const s = arrow.startBinding ? this.els.get(arrow.startBinding.elementId) : undefined;
    const t = arrow.endBinding ? this.els.get(arrow.endBinding.elementId) : undefined;
    const sOk = s && !s.isDeleted ? s : undefined;
    const tOk = t && !t.isDeleted ? t : undefined;
    // Aim at the first/last bend when there is one, else at the other shape.
    const firstBend = pts.length > 2 ? { x: arrow.x + pts[1][0], y: arrow.y + pts[1][1] } : null;
    const lastBend =
      pts.length > 2
        ? { x: arrow.x + pts[pts.length - 2][0], y: arrow.y + pts[pts.length - 2][1] }
        : null;
    const sc = sOk ? center(boxOf(sOk)) : absStart;
    const tc = tOk ? center(boxOf(tOk)) : absEnd;
    const start = sOk ? borderPoint(boxOf(sOk), firstBend ?? tc, 8, sOk.type) : absStart;
    const end = tOk ? borderPoint(boxOf(tOk), lastBend ?? sc, 8, tOk.type) : absEnd;
    // Bends follow the average movement of the two ends.
    const shift = !shiftBends
      ? { x: 0, y: 0 }
      : {
          x: (start.x - absStart.x + end.x - absEnd.x) / 2,
          y: (start.y - absStart.y + end.y - absEnd.y) / 2,
        };
    const abs = [
      start,
      ...pts
        .slice(1, -1)
        .map(([px, py]) => ({ x: arrow.x + px + shift.x, y: arrow.y + py + shift.y })),
      end,
    ];
    const x0 = Math.round(start.x);
    const y0 = Math.round(start.y);
    const points = abs.map((p) => [Math.round(p.x - x0), Math.round(p.y - y0)] as [number, number]);
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const patch = {
      x: x0,
      y: y0,
      points,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
    if (
      arrow.x === patch.x &&
      arrow.y === patch.y &&
      JSON.stringify(arrow.points) === JSON.stringify(points)
    )
      return;
    this.mutate(arrow, patch);
    this.centerLabel(arrow);
  }

  /** Move a node (and its label) and re-route attached arrows. */
  private moveNode(el: El, box: Box) {
    if (el.x === box.x && el.y === box.y && el.width === box.w && el.height === box.h) return;
    this.mutate(el, { x: box.x, y: box.y, width: box.w, height: box.h });
    this.centerLabel(el);
    for (const a of this.arrowsBoundTo(el.id)) this.routeArrow(a);
  }

  private addBound(container: El, ref: { id: string; type: string }) {
    const list = (container.boundElements ?? []).filter((b: any) => b.id !== ref.id);
    this.mutate(container, { boundElements: [...list, ref] });
  }

  private removeBound(container: El, id: string) {
    if (!container.boundElements?.some((b: any) => b.id === id)) return;
    this.mutate(container, {
      boundElements: container.boundElements.filter((b: any) => b.id !== id),
    });
  }

  private setLabel(container: El, label: string, author: Author) {
    const existing = this.boundText(container);
    const fontSize = existing?.fontSize ?? (container.type === "arrow" ? 16 : 20);
    const m = measureText(label, fontSize);
    if (existing) {
      this.mutate(existing, {
        text: label,
        originalText: label,
        width: m.width,
        height: m.height,
      });
    } else {
      const t = this.add(
        this.textEl(
          label,
          { x: container.x, y: container.y, w: m.width, h: m.height },
          author,
          fontSize,
          {
            containerId: container.id,
            frameId: container.frameId ?? null,
          },
        ),
      );
      this.addBound(container, { id: t.id, type: "text" });
    }
    if (container.type !== "arrow") {
      const w = Math.max(container.width, m.width + PAD);
      const h = Math.max(container.height, m.height + PAD);
      if (w !== container.width || h !== container.height)
        this.moveNode(container, { x: container.x, y: container.y, w, h });
    }
    this.centerLabel(container);
  }

  private deleteEl(el: El) {
    if (el.isDeleted) return;
    this.mutate(el, { isDeleted: true });
    const t = this.boundText(el);
    if (t) this.mutate(t, { isDeleted: true });
    if (el.type === "arrow" || el.type === "line") {
      for (const end of [el.startBinding, el.endBinding]) {
        const n = end ? this.els.get(end.elementId) : undefined;
        if (n) this.removeBound(n, el.id);
      }
    }
    if (el.type === "frame") {
      for (const k of this.live().filter((e) => e.frameId === el.id))
        this.mutate(k, { frameId: null });
    }
  }

  // ---------- ops ----------

  private setRef(ref: string | undefined, id: string) {
    if (ref) this.refs.set(ref, id);
  }

  addNode(o: Extract<Op, { op: "add_node" }>, author: Author): El {
    const comp = o.kind ? componentByKind.get(o.kind) : undefined;
    if (o.kind && !comp) throw new Error(`unknown kind "${o.kind}" (see the components resource)`);
    const label = o.label ?? comp?.label;
    if (!label) throw new Error("add_node needs a label or a kind");
    let frame = this.impliedFrame(o.frame, o.place);
    const m = measureText(label, 20);
    const w = Math.max(o.width ?? NODE_MIN_W, m.width + PAD);
    const h = Math.max(o.height ?? NODE_MIN_H, m.height + PAD);
    const box = this.place(o.place, w, h, frame);
    const shape = o.shape ?? comp?.shape ?? "rectangle";
    const fill = o.color ? (COLORS[o.color] ?? o.color) : (comp?.fill ?? "transparent");
    const node = this.add(
      this.base(shape, box, author, {
        backgroundColor: fill,
        roundness: shape === "rectangle" ? { type: 3 } : shape === "diamond" ? { type: 2 } : null,
        frameId: frame?.id ?? null,
        customData: { author, ...(comp ? { kind: comp.kind } : {}) },
      }),
    );
    if (!frame && (frame = this.frameAt(box))) this.setFrame(node, frame);
    this.setLabel(node, label, author);
    if (frame) this.fitFrame(frame);
    this.lastPlaced = node.id;
    this.setRef(o.ref, node.id);
    return node;
  }

  connect(o: Extract<Op, { op: "connect" }>, author: Author): El {
    const a = this.resolve(o.from);
    const b = this.resolve(o.to);
    if (a.id === b.id) throw new Error("cannot connect an element to itself");
    const arrow = this.add(
      this.base("arrow", { x: 0, y: 0, w: 0, h: 0 }, author, {
        strokeStyle: o.dashed ? "dashed" : "solid",
        roundness: { type: 2 },
        points: [
          [0, 0],
          [1, 1],
        ],
        lastCommittedPoint: null,
        startBinding: { elementId: a.id, focus: 0, gap: 8, fixedPoint: null },
        endBinding: { elementId: b.id, focus: 0, gap: 8, fixedPoint: null },
        startArrowhead: o.bidirectional ? "arrow" : null,
        endArrowhead: "arrow",
        elbowed: false,
      }),
    );
    this.addBound(a, { id: arrow.id, type: "arrow" });
    this.addBound(b, { id: arrow.id, type: "arrow" });
    this.routeArrow(arrow);
    if (o.label) this.setLabel(arrow, o.label, author);
    return arrow;
  }

  disconnect(o: Extract<Op, { op: "disconnect" }>): number {
    const a = this.resolve(o.from);
    const b = this.resolve(o.to);
    const between = this.arrowsBoundTo(a.id).filter((e) => {
      const ends = [e.startBinding?.elementId, e.endBinding?.elementId];
      return ends.includes(a.id) && ends.includes(b.id);
    });
    if (!between.length) throw new Error(`no arrow between "${o.from}" and "${o.to}"`);
    between.forEach((e) => this.deleteEl(e));
    return between.length;
  }

  update(o: Extract<Op, { op: "update" }>, author: Author): El {
    const el = this.resolve(o.target);
    if (o.label !== undefined) {
      if (el.type === "frame") this.mutate(el, { name: o.label });
      else if (el.type === "text") {
        const text = el.containerId ? o.label : wrapText(o.label);
        const m = measureText(text, el.fontSize ?? 20);
        this.mutate(el, {
          text,
          originalText: text,
          width: m.width,
          height: m.height,
        });
        if (el.frameId) this.fitFrame(this.els.get(el.frameId)!);
      } else this.setLabel(el, o.label, author);
    }
    if (o.color !== undefined) this.mutate(el, { backgroundColor: COLORS[o.color] ?? o.color });
    if (o.dashed !== undefined) this.mutate(el, { strokeStyle: o.dashed ? "dashed" : "solid" });
    if (o.shape && SHAPE_TYPES.has(el.type)) {
      this.mutate(el, {
        type: o.shape,
        roundness:
          o.shape === "rectangle" ? { type: 3 } : o.shape === "diamond" ? { type: 2 } : null,
      });
    }
    if (o.frame !== undefined) {
      const f = o.frame === null ? null : this.frameOf(o.frame);
      this.mutate(el, { frameId: f?.id ?? null });
      const t = this.boundText(el);
      if (t) this.mutate(t, { frameId: f?.id ?? null });
      if (f && !o.move) {
        const inside =
          el.x >= f.x &&
          el.y >= f.y &&
          el.x + el.width <= f.x + f.width &&
          el.y + el.height <= f.y + f.height;
        if (!inside)
          this.moveNode(el, this.place(undefined, el.width, el.height, f, new Set([el.id])));
      }
      if (f) this.fitFrame(f);
    }
    if (el.type === "frame" && (o.move || o.width || o.height)) {
      const w = o.width ?? el.width;
      const h = o.height ?? el.height;
      const box = o.move
        ? this.place(o.move, w, h, null, new Set([el.id]))
        : { x: el.x, y: el.y, w, h };
      this.moveFrameBy(el, box.x - el.x, box.y - el.y);
      if (w !== el.width || h !== el.height) this.mutate(el, { width: w, height: h });
      this.fitFrame(el);
      this.grownFrames.add(el.id);
    } else if (o.move || o.width || o.height) {
      const w = o.width ?? el.width;
      const h = o.height ?? el.height;
      const box = o.move
        ? this.place(o.move, w, h, null, new Set([el.id]))
        : { x: el.x, y: el.y, w, h };
      this.moveNode(el, box);
      if (el.frameId) this.fitFrame(this.els.get(el.frameId)!);
    }
    this.customTag(el, author);
    return el;
  }

  private customTag(el: El, author: Author) {
    if (author === "agent" && el.customData?.author !== "agent") {
      el.customData = { ...(el.customData ?? {}), editedBy: "agent" };
    }
  }

  remove(o: Extract<Op, { op: "remove" }>) {
    const el = this.resolve(o.target);
    if (this.isNode(el)) for (const a of this.arrowsBoundTo(el.id)) this.deleteEl(a);
    this.deleteEl(el);
    return el;
  }

  addFrame(o: Extract<Op, { op: "add_frame" }>, author: Author): El {
    const kids = (o.contains ?? []).map((t) => this.resolve(t));
    let box: Box;
    if (kids.length) {
      const u = unionBox(kids.map(boxOf))!;
      box = { x: u.x - PAD, y: u.y - PAD, w: u.w + PAD * 2, h: u.h + PAD * 2 };
    } else {
      box = this.place(o.place, o.width ?? 800, o.height ?? 500, null);
    }
    const frame = this.add(
      this.base("frame", box, author, {
        name: o.name,
        strokeColor: "#bbb",
        roughness: 0,
      }),
    );
    for (const k of kids) {
      this.mutate(k, { frameId: frame.id });
      const t = this.boundText(k);
      if (t) this.mutate(t, { frameId: frame.id });
    }
    this.setRef(o.ref, frame.id);
    return frame;
  }

  addNote(o: Extract<Op, { op: "add_note" }>, author: Author): El {
    let frame = this.impliedFrame(o.frame, o.place);
    const fontSize = { s: 16, m: 20, l: 28 }[o.size ?? "m"];
    const text = wrapText(o.text);
    const m = measureText(text, fontSize);
    const box = this.place(o.place, m.width, m.height, frame);
    frame ??= this.frameAt(box);
    const t = this.add(this.textEl(text, box, author, fontSize, { frameId: frame?.id ?? null }));
    if (frame) this.fitFrame(frame);
    this.setRef(o.ref, t.id);
    return t;
  }

  apply(ops: Op[], author: Author): OpResult[] {
    const results = this.applyOps(ops, author);
    this.enforceBindings();
    return results;
  }

  private applyOps(ops: Op[], author: Author): OpResult[] {
    return ops.map((o, i) => {
      try {
        let el: El | undefined;
        switch (o.op) {
          case "add_node":
            el = this.addNode(o, author);
            break;
          case "connect":
            el = this.connect(o, author);
            break;
          case "disconnect":
            this.disconnect(o);
            break;
          case "update":
            el = this.update(o, author);
            break;
          case "remove":
            el = this.remove(o);
            break;
          case "add_frame":
            el = this.addFrame(o, author);
            break;
          case "add_note":
            el = this.addNote(o, author);
            break;
          default:
            throw new Error(`unknown op ${(o as any).op}`);
        }
        return { i, op: o.op, ok: true, id: el?.id, ref: (o as any).ref };
      } catch (err) {
        return { i, op: o.op, ok: false, error: (err as Error).message };
      }
    });
  }

  // ---------- formatting ----------

  /** Frames touched by this Scene's changes (for scoped auto-tidy). null frame = top level. */
  touchedFrames(): Set<string | null> {
    const out = new Set<string | null>();
    for (const id of this.changed) {
      const e = this.els.get(id);
      if (!e || e.isDeleted) continue;
      out.add(e.type === "frame" ? e.id : (e.frameId ?? null));
    }
    return out;
  }

  /**
   * Non-destructive cleanup: never changes connections, labels, colours or relative order.
   * scope: frames (null = top level) to tidy; undefined = everything.
   */
  tidy(scope?: Set<string | null>): TidyStats {
    const stats: TidyStats = {
      bound: 0,
      rerouted: 0,
      adopted: 0,
      wrapped: 0,
      aligned: 0,
      separated: 0,
      framesMoved: 0,
    };
    const inScope = (fid: string | null | undefined) => !scope || scope.has(fid ?? null);
    const isBlock = (e: El) => this.isNode(e) || (e.type === "text" && !e.containerId);

    // 0. Bind loose arrow ends that touch a node, so links survive every later move.
    const nodes0 = this.live().filter((e) => this.isNode(e));
    const near = (p: { x: number; y: number }) =>
      nodes0.find(
        (n) =>
          p.x >= n.x - 20 &&
          p.x <= n.x + n.width + 20 &&
          p.y >= n.y - 20 &&
          p.y <= n.y + n.height + 20,
      );
    for (const a of this.live()) {
      if (a.type !== "arrow" || !inScope(a.frameId)) continue;
      const pts = a.points as [number, number][];
      for (const [side, p] of [
        ["startBinding", pts[0]],
        ["endBinding", pts[pts.length - 1]],
      ] as const) {
        if (a[side]) continue;
        const n = near({ x: a.x + p[0], y: a.y + p[1] });
        const other = side === "startBinding" ? a.endBinding : a.startBinding;
        if (!n || other?.elementId === n.id) continue;
        this.mutate(a, { [side]: { elementId: n.id, focus: 0, gap: 8, fixedPoint: null } });
        this.addBound(n, { id: a.id, type: "arrow" });
        stats.bound++;
      }
    }

    // 1. Attach loose nodes/notes to the frame they sit in.
    for (const e of this.live()) {
      if (!isBlock(e) || e.frameId) continue;
      const f = this.frameAt(boxOf(e));
      if (f && inScope(f.id)) {
        this.setFrame(e, f);
        stats.adopted++;
      }
    }

    // 2. Wrap notes that are far too wide.
    for (const e of this.live()) {
      if (e.type !== "text" || e.containerId || !inScope(e.frameId)) continue;
      const wrapped = wrapText(e.text ?? "");
      if (wrapped !== e.text) {
        const m = measureText(wrapped, e.fontSize ?? 20);
        this.mutate(e, {
          text: wrapped,
          originalText: wrapped,
          width: m.width,
          height: m.height,
        });
        stats.wrapped++;
      }
    }

    const groups = new Map<string | null, El[]>();
    for (const e of this.live()) {
      if (!isBlock(e) || !inScope(e.frameId)) continue;
      const k = e.frameId ?? null;
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }

    // Steps 3-4 repeat until stable: a separation can unblock a snap that was refused before.
    for (let outer = 0; outer < 4; outer++) {
      const before = stats.aligned + stats.separated;
      for (const items of groups.values()) {
        // 3. Snap nodes whose centres are nearly in a row / column onto the cluster's largest box
        //    (a fixed anchor, so repeated runs converge). Never snap into a collision.
        const nodes = items.filter((e) => this.isNode(e));
        for (let round = 0; round < 4; round++) {
          let snapped = 0;
          for (const axis of ["y", "x"] as const) {
            const size = axis === "y" ? "height" : "width";
            const mid = (e: El) => e[axis] + e[size] / 2;
            const sorted = [...nodes].sort((a, b) => mid(a) - mid(b));
            let cluster: El[] = [];
            const flush = () => {
              if (cluster.length > 1) {
                const anchor = cluster.reduce((m, e) =>
                  e.width * e.height > m.width * m.height ? e : m,
                );
                for (const e of cluster) {
                  const d = mid(anchor) - mid(e);
                  if (e === anchor || Math.abs(d) < 1) continue;
                  const box = {
                    ...boxOf(e),
                    [axis]: Math.round(e[axis] + d),
                  } as Box;
                  if (items.some((o) => o !== e && overlaps(box, boxOf(o), 23))) continue;
                  this.moveNode(e, box);
                  snapped++;
                }
              }
              cluster = [];
            };
            for (const e of sorted) {
              if (cluster.length && mid(e) - mid(cluster[0]) > 16) flush();
              cluster.push(e);
            }
            flush();
          }
          stats.aligned += snapped;
          if (!snapped) break;
        }

        // 4. Separate overlapping blocks with the smallest push; the later one (reading order) moves.
        const M = 24;
        for (let pass = 0; pass < 40; pass++) {
          let moved = false;
          const order = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
          for (let i = 0; i < order.length; i++) {
            for (let j = i + 1; j < order.length; j++) {
              const a = order[i];
              const b = order[j];
              if (!overlaps(boxOf(a), boxOf(b), M - 1)) continue;
              const px = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) + M;
              const py = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) + M;
              const box = boxOf(b);
              if (px < py) box.x += b.x + b.width / 2 >= a.x + a.width / 2 ? px : -px;
              else box.y += py;
              if (this.isNode(b))
                this.moveNode(b, {
                  ...box,
                  x: Math.round(box.x),
                  y: Math.round(box.y),
                });
              else this.mutate(b, { x: Math.round(box.x), y: Math.round(box.y) });
              stats.separated++;
              moved = true;
            }
          }
          if (!moved) break;
        }
      }
      if (stats.aligned + stats.separated === before) break;
    }

    // Repair: every bound arrow in scope is re-derived from its shapes (no-op when already right).
    for (const a of this.live()) {
      if (a.type === "arrow" && (a.startBinding || a.endBinding) && inScope(a.frameId))
        this.routeArrow(a);
    }

    // Detour: bend straight arrows (or our own earlier bends) around boxes they pass through.
    for (const a of this.live()) {
      if (
        a.type === "arrow" &&
        (a.startBinding || a.endBinding) &&
        inScope(a.frameId) &&
        this.detour(a)
      )
        stats.rerouted++;
    }

    // 5. Fit frames around their contents, then 6. pull overlapping frames apart.
    const frames = this.live().filter((f) => f.type === "frame" && inScope(f.id));
    for (const f of frames) this.fitFrame(f);
    stats.framesMoved = this.separateFrames(
      scope ? [...this.grownFrames, ...frames.map((f) => f.id)] : frames.map((f) => f.id),
    );
    this.enforceBindings();
    return stats;
  }

  // ---------- bulk ----------

  /** Auto-layout nodes with dagre. Scope: a frame (its children) or all top-level nodes. */
  layout(direction: "LR" | "TB", scopeFrame?: string) {
    const frame = this.frameOf(scopeFrame);
    const nodes = this.live().filter(
      (e) => this.isNode(e) && (frame ? e.frameId === frame.id : !e.frameId),
    );
    if (!nodes.length) throw new Error("nothing to lay out");
    const ids = new Set(nodes.map((n) => n.id));
    const before = unionBox(nodes.map(boxOf))!;
    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: direction,
      nodesep: 60,
      ranksep: 120,
      marginx: 0,
      marginy: 0,
    });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height });
    for (const e of this.graph()._edgesRaw)
      if (ids.has(e.fromId ?? "") && ids.has(e.toId ?? "")) g.setEdge(e.fromId!, e.toId!);
    dagre.layout(g);
    for (const n of nodes) {
      const p = g.node(n.id);
      this.moveNode(n, {
        x: Math.round(before.x + p.x - n.width / 2),
        y: Math.round(before.y + p.y - n.height / 2),
        w: n.width,
        h: n.height,
      });
    }
    if (frame) this.fitFrame(frame);
    return nodes.length;
  }

  /** Add externally-converted elements (e.g. from Mermaid) as a block placed in free space. */
  addForeign(elements: El[], author: Author) {
    const live = elements
      .filter((e) => !e.isDeleted)
      .sort((a, b) =>
        (a.index ?? "") < (b.index ?? "") ? -1 : (a.index ?? "") > (b.index ?? "") ? 1 : 0,
      );
    const u = unionBox(live.map(boxOf));
    if (!u) return 0;
    const target = this.place(undefined, u.w, u.h, null);
    const dx = target.x - u.x;
    const dy = target.y - u.y;
    for (const e of live) {
      const el: El = {
        ...e,
        x: Math.round(e.x + dx),
        y: Math.round(e.y + dy),
        version: 1,
        versionNonce: rnd(),
        updated: Date.now(),
        customData: { ...(e.customData ?? {}), author },
      };
      if (author === "agent" && el.type !== "text") el.strokeColor = AGENT_STROKE;
      this.add(el);
    }
    return live.length;
  }

  /** Replace the whole scene with `target`, bumping versions so every client converges. */
  restoreTo(target: El[]) {
    const want = new Map(target.map((e) => [e.id, e]));
    for (const cur of this.els.values()) {
      if (!want.has(cur.id) && !cur.isDeleted) this.mutate(cur, { isDeleted: true });
    }
    for (const t of want.values()) {
      const cur = this.els.get(t.id);
      const v = Math.max(cur?.version ?? 0, t.version ?? 0);
      const el: El = { ...t, version: v, versionNonce: t.versionNonce };
      this.els.set(el.id, el);
      this.mutate(el);
    }
  }

  // ---------- read model ----------

  graph(selection?: Set<string>) {
    const live = this.live();
    const nodes = live.filter((e) => this.isNode(e));
    const frames = live.filter((e) => e.type === "frame");
    const frameName = (id: string | null | undefined) =>
      id ? (this.els.get(id)?.name ?? id) : undefined;
    const labelCounts = new Map<string, number>();
    for (const n of nodes) {
      const l = this.labelOf(n);
      labelCounts.set(l, (labelCounts.get(l) ?? 0) + 1);
    }
    const display = (e: El | undefined) => {
      if (!e) return undefined;
      const l = this.labelOf(e);
      return l && labelCounts.get(l) === 1 ? l : `${l || e.type}#${e.id}`;
    };
    const hit = (p: { x: number; y: number }) =>
      nodes.find(
        (n) =>
          p.x >= n.x - 25 &&
          p.x <= n.x + n.width + 25 &&
          p.y >= n.y - 25 &&
          p.y <= n.y + n.height + 25,
      );

    const edges: {
      id: string;
      from?: string;
      to?: string;
      fromId?: string;
      toId?: string;
      label?: string;
      dashed?: true;
      both?: true;
      inferred?: true;
    }[] = [];
    const sketches: {
      id: string;
      type: string;
      x: number;
      y: number;
      w: number;
      h: number;
      frame?: string;
    }[] = [];

    for (const e of live) {
      if (e.type !== "arrow" && e.type !== "line") continue;
      const pts = e.points as [number, number][];
      let from = e.startBinding ? this.els.get(e.startBinding.elementId) : undefined;
      let to = e.endBinding ? this.els.get(e.endBinding.elementId) : undefined;
      let inferred = false;
      if (!from) {
        from = hit({ x: e.x + pts[0][0], y: e.y + pts[0][1] });
        inferred ||= !!from;
      }
      if (!to) {
        to = hit({
          x: e.x + pts[pts.length - 1][0],
          y: e.y + pts[pts.length - 1][1],
        });
        inferred ||= !!to;
      }
      if (from && to && from.id !== to.id) {
        const label = this.boundText(e)?.text;
        edges.push({
          id: e.id,
          from: display(from),
          to: display(to),
          fromId: from.id,
          toId: to.id,
          ...(label ? { label } : {}),
          ...(e.strokeStyle !== "solid" ? { dashed: true as const } : {}),
          ...(e.startArrowhead && e.endArrowhead ? { both: true as const } : {}),
          ...(inferred ? { inferred: true as const } : {}),
        });
      } else {
        sketches.push({
          id: e.id,
          type: e.type,
          x: Math.round(e.x),
          y: Math.round(e.y),
          w: Math.round(e.width),
          h: Math.round(e.height),
          frame: frameName(e.frameId),
        });
      }
    }
    for (const e of live) {
      if (e.type === "freedraw" || e.type === "image") {
        sketches.push({
          id: e.id,
          type: e.type,
          x: Math.round(e.x),
          y: Math.round(e.y),
          w: Math.round(e.width),
          h: Math.round(e.height),
          frame: frameName(e.frameId),
        });
      }
    }

    const sel = selection && selection.size ? selection : undefined;
    return {
      frames: frames.map((f) => ({
        id: f.id,
        name: f.name ?? "",
        x: Math.round(f.x),
        y: Math.round(f.y),
        w: Math.round(f.width),
        h: Math.round(f.height),
      })),
      nodes: nodes.map((n) => ({
        id: n.id,
        label: this.labelOf(n),
        shape: n.type,
        x: Math.round(n.x),
        y: Math.round(n.y),
        w: Math.round(n.width),
        h: Math.round(n.height),
        ...(n.frameId ? { frame: frameName(n.frameId) } : {}),
        ...(n.backgroundColor && n.backgroundColor !== "transparent"
          ? { color: COLOR_NAMES[n.backgroundColor] ?? n.backgroundColor }
          : {}),
        ...(n.customData?.kind ? { kind: n.customData.kind } : {}),
        ...(n.customData?.author === "agent" ? { by: "agent" } : {}),
        ...(sel?.has(n.id) ? { selected: true } : {}),
      })),
      edges: edges.map(({ fromId: _fromId, toId: _toId, ...rest }) => ({
        ...rest,
        ...(sel?.has(rest.id) ? { selected: true } : {}),
      })),
      notes: live
        .filter((e) => e.type === "text" && !e.containerId)
        .map((t) => ({
          id: t.id,
          text: t.text,
          x: Math.round(t.x),
          y: Math.round(t.y),
          ...(t.frameId ? { frame: frameName(t.frameId) } : {}),
          ...(t.customData?.author === "agent" ? { by: "agent" } : {}),
          ...(sel?.has(t.id) ? { selected: true } : {}),
        })),
      sketches,
      _edgesRaw: edges,
    };
  }
}

/** Compact graph for the agent (drops the internal raw edge list). */
export function graphView(scene: Scene, selection?: Set<string>) {
  const { _edgesRaw, ...g } = scene.graph(selection);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(g)) if ((v as unknown[]).length) out[k] = v;
  return out;
}
