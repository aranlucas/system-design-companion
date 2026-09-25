// Scene engine: semantic ops ⇄ Excalidraw elements. Pure logic, no Workers APIs.
import dagre from "@dagrejs/dagre";
import { generateKeyBetween } from "fractional-indexing";
import { iconElements } from "../shared/icons.ts";
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

/** Excalidraw's stroke palette: readable on white and on the fills above. */
export const TEXT_COLORS: Record<string, string> = {
  black: "#1e1e1e",
  gray: "#868e96",
  red: "#e03131",
  pink: "#c2255c",
  violet: "#6741d9",
  blue: "#1971c2",
  cyan: "#0c8599",
  green: "#2f9e44",
  yellow: "#f08c00",
  orange: "#e8590c",
};
const TEXT_COLOR_NAMES = Object.fromEntries(Object.entries(TEXT_COLORS).map(([k, v]) => [v, k]));
const textColor = (color: string) => TEXT_COLORS[color] ?? color;
/** How graph() reports a text color: omitted when it is a default (black, or agent violet). */
const reportTextColor = (text: El | undefined) =>
  text && text.strokeColor !== TEXT_COLORS.black && text.strokeColor !== AGENT_STROKE
    ? { text_color: TEXT_COLOR_NAMES[text.strokeColor] ?? text.strokeColor }
    : {};

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
      text_color?: string;
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
      text_color?: string;
      dashed?: boolean;
      bidirectional?: boolean;
    }
  | { op: "disconnect"; from: string; to: string }
  | {
      op: "update";
      target: string;
      label?: string;
      color?: string;
      text_color?: string;
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
      text_color?: string;
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
/** How far an unbound arrow end may sit from a node and still count as connected to it. */
const ARROW_REACH = 25;

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
  spaced: number;
  separated: number;
  framesFitted: number;
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

const boxOf = (e: El): Box => {
  if ((e.type === "arrow" || e.type === "line") && e.points?.length) {
    const xs = e.points.map((p: number[]) => p[0]);
    const ys = e.points.map((p: number[]) => p[1]);
    return {
      x: e.x + Math.min(...xs),
      y: e.y + Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  }
  return { x: e.x, y: e.y, w: e.width, h: e.height };
};
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

/** Groups of 2+ items whose `key` lies within `tol` of the group's first item. */
function clusters<T>(items: T[], key: (t: T) => number, tol: number): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  for (const t of [...items].sort((a, b) => key(a) - key(b))) {
    if (cur.length && key(t) - key(cur[0]) > tol) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
    cur.push(t);
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

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
    // Edits stay local until the caller commits them, including nested bindings.
    this.els = new Map(structuredClone([...elements]).map((e) => [e.id, e]));
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
    if (container.customData?.icon) {
      const group = container.groupIds?.at(-1);
      const caption = this.live().find(
        (e) => e.customData?.componentLabel && group && e.groupIds?.includes(group),
      );
      if (caption) return caption;
    }
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

  /** Node an unbound arrow end at `p` points at: the closest within ARROW_REACH, centre breaks ties. */
  nodeAt(p: Pt, nodes: El[]): El | undefined {
    let best: El | undefined;
    let bestKey = [Infinity, Infinity];
    for (const n of nodes) {
      const b = boxOf(n);
      const d = distToBox(p, b);
      if (d > ARROW_REACH) continue;
      const c = center(b);
      const key = [d, Math.hypot(p.x - c.x, p.y - c.y)];
      if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
        best = n;
        bestKey = key;
      }
    }
    return best;
  }

  isNode(e: El) {
    return !e.isDeleted && !e.customData?.componentPart && SHAPE_TYPES.has(e.type);
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
        (this.isNode(e) ||
          e.type === "frame" ||
          (e.type === "text" && !e.containerId && !e.customData?.componentLabel)) &&
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
          !e.customData?.componentPart &&
          !e.customData?.componentLabel &&
          e.type !== "frame" &&
          e.type !== "arrow" &&
          !(e.type === "text" && e.containerId),
      )
      .map((e) => {
        const label = e.customData?.icon ? this.boundText(e) : undefined;
        return label ? unionBox([boxOf(e), boxOf(label)])! : boxOf(e);
      });
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
  /**
   * Grow a frame to hold its contents plus PAD. With `shrink`, a frame that only grew because
   * of fitting (and hasn't been resized since) shrinks back as far as its contents allow, but
   * never below the size someone chose. That size is kept in customData.autoFit, relative to the
   * frame so moving the frame keeps it valid. Returns true if the frame changed.
   */
  private fitFrame(frame: El, shrink = false): boolean {
    // Connections are routed inside the frame instead (see detour), so they don't grow it.
    const isBoundArrow = (e: El | undefined) =>
      e?.type === "arrow" && !!(e.startBinding || e.endBinding);
    const kids = this.live()
      .filter(
        (e) =>
          e.frameId === frame.id &&
          !isBoundArrow(e) &&
          !(e.containerId && isBoundArrow(this.els.get(e.containerId))),
      )
      .map(boxOf);
    const u = unionBox(kids);
    if (!u) return false;
    const auto = frame.customData?.autoFit as
      | { dx: number; dy: number; w: number; h: number; fw: number; fh: number }
      | undefined;
    const current = { x: frame.x, y: frame.y, w: frame.width, h: frame.height };
    // A resize since the last fit means someone chose this size: it becomes the new floor.
    const chosen =
      auto && frame.width === auto.fw && frame.height === auto.fh
        ? { x: frame.x + auto.dx, y: frame.y + auto.dy, w: auto.w, h: auto.h }
        : current;
    const floor = shrink ? chosen : current;
    const nx = Math.min(floor.x, u.x - PAD);
    const ny = Math.min(floor.y, u.y - PAD);
    const nr = Math.max(floor.x + floor.w, u.x + u.w + PAD);
    const nb = Math.max(floor.y + floor.h, u.y + u.h + PAD);
    if (
      nx === frame.x &&
      ny === frame.y &&
      nr === frame.x + frame.width &&
      nb === frame.y + frame.height
    )
      return false;
    const autoFit = {
      dx: chosen.x - nx,
      dy: chosen.y - ny,
      w: chosen.w,
      h: chosen.h,
      fw: nr - nx,
      fh: nb - ny,
    };
    this.mutate(frame, {
      x: nx,
      y: ny,
      width: nr - nx,
      height: nb - ny,
      customData: { ...(frame.customData ?? {}), autoFit },
    });
    this.grownFrames.add(frame.id);
    return true;
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
    for (const part of this.iconParts(el)) this.mutate(part, { frameId: frame?.id ?? null });
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
        y: container.customData?.icon
          ? container.y + container.height + 14
          : Math.round(c.y - t.height / 2),
        verticalAlign: container.customData?.icon ? "top" : "middle",
        groupIds: container.groupIds ?? [],
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
   * If a bound arrow passes through a box that isn't one of its ends, route it around nearby
   * obstacles using short endpoint exits or midpoint bends. Only touches straight arrows and bends we added (autoBend);
   * straightens our bend again once the straight path is clear. Returns true if it changed.
   */
  private detour(arrow: El): boolean {
    const pts = arrow.points as [number, number][];
    const ours = arrow.customData?.autoBend === true;
    const source = this.els.get(arrow.startBinding?.elementId);
    const target = this.els.get(arrow.endBinding?.elementId);
    const frame =
      source?.frameId && source.frameId === target?.frameId
        ? this.els.get(source.frameId)
        : undefined;
    const text = this.boundText(arrow);
    const inside = (path: Pt[]) => {
      if (!frame) return true;
      const contains = (p: Pt, mx = 8, my = 8) =>
        p.x >= frame.x + mx &&
        p.x <= frame.x + frame.width - mx &&
        p.y >= frame.y + my &&
        p.y <= frame.y + frame.height - my;
      const mid = (path.length - 1) / 2;
      const a = path[Math.floor(mid)],
        b = path[Math.ceil(mid)];
      return (
        path.every((p) => contains(p)) &&
        contains(
          { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          (text?.width ?? 0) / 2 + 8,
          (text?.height ?? 0) / 2 + 8,
        )
      );
    };
    const existing = pts.map(([x, y]) => ({ x: arrow.x + x, y: arrow.y + y }));
    if (pts.length > 2 && !ours && inside(existing)) return false; // preserve valid human curves
    const ends = new Set([arrow.startBinding?.elementId, arrow.endBinding?.elementId]);
    // A framed arrow must stay inside its frame, so only boxes overlapping the frame can block it.
    const obstacles = this.live()
      .filter((n) => (this.isNode(n) && !ends.has(n.id)) || n.customData?.componentLabel)
      .map(boxOf)
      .filter((o) => !frame || overlaps(o, boxOf(frame), 10));
    const clear = (path: Pt[]) => {
      if (!inside(path)) return false;
      const span = unionBox(path.map((p) => ({ ...p, w: 0, h: 0 })))!;
      const near = obstacles.filter((o) => overlaps(o, span, 10));
      return path.every(
        (p, i) => i === 0 || !near.some((o) => segmentHitsBox(path[i - 1], p, o, 10)),
      );
    };
    const abs = (a: El) =>
      (a.points as [number, number][]).map(([px, py]) => ({ x: a.x + px, y: a.y + py }));
    const setPath = (bends: Pt[]) => {
      const cur = abs(arrow);
      const s0 = cur[0];
      const e0 = cur.at(-1)!;
      const rel = (pt: Pt): [number, number] => [Math.round(pt.x - s0.x), Math.round(pt.y - s0.y)];
      const points = [rel(s0), ...bends.map(rel), rel(e0)];
      this.mutate(arrow, {
        points,
        customData: { ...(arrow.customData ?? {}), autoBend: bends.length > 0 },
      });
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
        setPath([]);
        return true;
      }
      return false;
    }

    // Re-aim endpoints at the proposed bends, using the same pixel rounding as routeArrow.
    const sEl = arrow.startBinding && this.els.get(arrow.startBinding.elementId);
    const tEl = arrow.endBinding && this.els.get(arrow.endBinding.elementId);
    const pixel = (point: Pt): Pt => ({ x: Math.round(point.x), y: Math.round(point.y) });
    const aimed = (bends: Pt[]): Pt[] => [
      pixel(sEl ? borderPoint(boxOf(sEl), bends[0], 8, sEl.type) : straight[0]),
      ...bends,
      pixel(tEl ? borderPoint(boxOf(tEl), bends.at(-1)!, 8, tEl.type) : straight[1]),
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
    // Score actual travel distance so a short exit beside a caption can beat a
    // large midpoint loop. Penalise extra bends and crossings for readability.
    const cost = (path: Pt[]) => {
      const length = path
        .slice(1)
        .reduce((sum, point, i) => sum + Math.hypot(point.x - path[i].x, point.y - path[i].y), 0);
      const bends = path.slice(1, -1);
      const cramped = bends.some(
        (bend) =>
          others.some(([a, b]) => distToSegment(bend, a, b) < 40) ||
          obstacles.some((o) => distToBox(bend, o) < 40),
      );
      return length + 20 * bends.length + 150 * crossings(path) + (cramped ? 60 : 0);
    };
    const candidates: Pt[][] = [];
    const exits = (node: El | undefined): Pt[] => {
      if (!node) return [];
      const caption = node.customData?.icon ? this.boundText(node) : undefined;
      const bounds = unionBox([boxOf(node), ...(caption ? [boxOf(caption)] : [])])!;
      const c = center(boxOf(node));
      return [
        ...[node.y, c.y, node.y + node.height].flatMap((y) => [
          { x: bounds.x - 40, y },
          { x: bounds.x + bounds.w + 40, y },
        ]),
        { x: c.x, y: bounds.y - 40 },
        { x: c.x, y: bounds.y + bounds.h + 40 },
      ];
    };
    const sourceExits = exits(sEl),
      targetExits = exits(tEl);
    for (const exit of [...sourceExits, ...targetExits]) candidates.push([exit]);
    for (const start of sourceExits) for (const end of targetExits) candidates.push([start, end]);
    for (let d = 40; d <= 800; d += 20)
      for (const sign of [1, -1])
        candidates.push([{ x: mid.x + nx * d * sign, y: mid.y + ny * d * sign }]);

    // Keep a valid existing route unless the replacement is materially shorter.
    // This also prevents rounding or small neighbouring edits from causing jitter.
    const currentCost = pts.length > 2 && clear(current) ? cost(current) : Infinity;
    let best: { bends: Pt[]; cost: number } | undefined;
    for (const candidate of candidates) {
      const bends = candidate.map(pixel);
      const path = aimed(bends);
      if (!clear(path)) continue;
      // Intermediate legs must not cut back through either endpoint's artwork.
      if (
        path.some(
          (point, i) =>
            i > 0 &&
            ((i > 1 && sEl && segmentHitsBox(path[i - 1], point, boxOf(sEl), 4)) ||
              (i < path.length - 1 && tEl && segmentHitsBox(path[i - 1], point, boxOf(tEl), 4))),
        )
      )
        continue;
      const candidateCost = cost(path);
      if (!best || candidateCost < best.cost) best = { bends, cost: candidateCost };
    }
    if (best && best.cost + 32 < currentCost) {
      setPath(best.bends);
      return true;
    }
    // If no obstacle-free detour fits, containment wins over avoiding crossings.
    // A crowded frame should not send its connections into another design section.
    if (!inside(current) && inside(straight)) {
      setPath([]);
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
    let start = sOk ? borderPoint(boxOf(sOk), firstBend ?? tc, 8, sOk.type) : absStart;
    let end = tOk ? borderPoint(boxOf(tOk), lastBend ?? sc, 8, tOk.type) : absEnd;
    // Bends follow the average movement of the two ends. Sub-pixel drift is rounding, not movement.
    const drift = (d: number) => (shiftBends && Math.abs(d) >= 1 ? d : 0);
    const shift = {
      x: drift((start.x - absStart.x + end.x - absEnd.x) / 2),
      y: drift((start.y - absStart.y + end.y - absEnd.y) / 2),
    };
    // Re-aim the ends at the moved bends, so a second pass finds nothing to fix.
    if (firstBend && lastBend && (shift.x || shift.y)) {
      const moved = (p: Pt) => ({ x: p.x + shift.x, y: p.y + shift.y });
      if (sOk) start = borderPoint(boxOf(sOk), moved(firstBend), 8, sOk.type);
      if (tOk) end = borderPoint(boxOf(tOk), moved(lastBend), 8, tOk.type);
    }
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
    const previous = boxOf(el);
    this.mutate(el, { x: box.x, y: box.y, width: box.w, height: box.h });
    for (const part of this.iconParts(el)) {
      const sx = box.w / previous.w,
        sy = box.h / previous.h;
      this.mutate(part, {
        x: box.x + (part.x - previous.x) * sx,
        y: box.y + (part.y - previous.y) * sy,
        width: part.width * sx,
        height: part.height * sy,
        ...(part.points ? { points: part.points.map(([x, y]: number[]) => [x * sx, y * sy]) } : {}),
      });
    }
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
    const caption = !!container.customData?.icon;
    const displayLabel = caption ? wrapText(label, 20) : label;
    const m = measureText(displayLabel, fontSize);
    if (existing) {
      this.mutate(existing, {
        text: displayLabel,
        originalText: label,
        width: m.width,
        height: m.height,
      });
    } else {
      const t = this.add(
        this.textEl(
          displayLabel,
          { x: container.x, y: container.y, w: m.width, h: m.height },
          author,
          fontSize,
          {
            containerId: caption ? null : container.id,
            ...(caption
              ? {
                  customData: { componentLabel: true, author },
                  groupIds: container.groupIds,
                  originalText: label,
                  textAlign: "center",
                  strokeColor: "#1e1e1e",
                }
              : {}),
            frameId: container.frameId ?? null,
          },
        ),
      );
      if (!caption) this.addBound(container, { id: t.id, type: "text" });
    }
    if (container.type !== "arrow" && !caption) {
      const w = Math.max(container.width, m.width + PAD);
      const h = Math.max(container.height, m.height + PAD);
      if (w !== container.width || h !== container.height)
        this.moveNode(container, { x: container.x, y: container.y, w, h });
    }
    this.centerLabel(container);
  }

  /** Color a note, or the label of a node or arrow. */
  private setTextColor(el: El, color: string) {
    const text = el.type === "text" ? el : this.boundText(el);
    if (!text) throw new Error("text_color needs a label to color");
    this.mutate(text, { strokeColor: textColor(color) });
  }

  /** The invisible binding target covers only artwork, never its caption. */
  private fitIconBounds(node: El) {
    const bounds = unionBox(this.iconParts(node).map(boxOf));
    if (bounds) this.mutate(node, { x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h });
  }

  private iconParts(el: El): El[] {
    if (!el.customData?.icon) return [];
    const group = el.groupIds?.at(-1);
    return this.live().filter(
      (part) => part.customData?.componentPart && group && part.groupIds?.includes(group),
    );
  }

  private deleteEl(el: El) {
    if (el.isDeleted) return;
    for (const part of this.iconParts(el)) this.mutate(part, { isDeleted: true });
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
    const icon = o.shape ? undefined : comp?.icon;
    const w = Math.max(
      o.width ?? NODE_MIN_W,
      (icon ? measureText(wrapText(label, 20), 20).width : m.width) + PAD,
    );
    const h = Math.max(o.height ?? (icon ? 120 : NODE_MIN_H), m.height + (icon ? 95 : PAD));
    const box = this.place(o.place, w, h, frame);
    const shape = icon ? "rectangle" : (o.shape ?? comp?.shape ?? "rectangle");
    const fill = o.color ? (COLORS[o.color] ?? o.color) : (comp?.fill ?? "transparent");
    const node = this.add(
      this.base(shape, box, author, {
        backgroundColor: icon ? "transparent" : fill,
        ...(icon ? { strokeColor: "transparent", groupIds: [newId()] } : {}),
        roundness: shape === "rectangle" ? { type: 3 } : shape === "diamond" ? { type: 2 } : null,
        frameId: frame?.id ?? null,
        customData: {
          author,
          ...(comp ? { kind: comp.kind } : {}),
          ...(icon ? { icon, iconFill: fill } : {}),
        },
      }),
    );
    if (!frame && (frame = this.frameAt(box))) this.setFrame(node, frame);
    if (icon && comp) {
      for (const part of iconElements(comp, w)) {
        const { type, x, y, width = 0, height = 0, ...style } = part;
        this.add(
          this.base(type, { x: box.x + x, y: box.y + y, w: width, h: height }, author, {
            backgroundColor:
              type === "line" &&
              !(
                style.points?.length &&
                JSON.stringify(style.points[0]) === JSON.stringify(style.points.at(-1))
              )
                ? "transparent"
                : fill,
            ...style,
            groupIds: node.groupIds,
            frameId: node.frameId,
            customData: { componentPart: true, author },
            ...(type === "line"
              ? {
                  lastCommittedPoint: null,
                  startBinding: null,
                  endBinding: null,
                  startArrowhead: null,
                  endArrowhead: null,
                }
              : {}),
          }),
        );
      }
    }
    if (icon) this.fitIconBounds(node);
    this.setLabel(node, label, author);
    if (o.text_color !== undefined) this.setTextColor(node, o.text_color);
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
    if (o.text_color !== undefined) this.setTextColor(arrow, o.text_color);
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
    if (o.text_color !== undefined) this.setTextColor(el, o.text_color);
    if (o.color !== undefined) {
      const color = COLORS[o.color] ?? o.color;
      if (el.customData?.icon) {
        this.mutate(el, { customData: { ...el.customData, iconFill: color } });
        for (const part of this.iconParts(el))
          if (part.backgroundColor !== "transparent") this.mutate(part, { backgroundColor: color });
      } else this.mutate(el, { backgroundColor: color });
    }
    if (o.dashed !== undefined) {
      for (const part of [el, ...this.iconParts(el)])
        this.mutate(part, { strokeStyle: o.dashed ? "dashed" : "solid" });
    }
    if (o.shape && SHAPE_TYPES.has(el.type)) {
      const caption = this.boundText(el);
      if (caption?.customData?.componentLabel) {
        const { componentLabel: _label, ...data } = caption.customData;
        this.mutate(caption, { containerId: el.id, customData: data });
        this.addBound(el, { id: caption.id, type: "text" });
      }
      for (const part of this.iconParts(el)) this.mutate(part, { isDeleted: true });
      const { icon: _icon, iconFill, ...data } = el.customData ?? {};
      this.mutate(el, {
        customData: data,
        ...(iconFill
          ? {
              backgroundColor: iconFill,
              strokeColor: author === "agent" ? AGENT_STROKE : "#1e1e1e",
            }
          : {}),
        type: o.shape,
        roundness:
          o.shape === "rectangle" ? { type: 3 } : o.shape === "diamond" ? { type: 2 } : null,
      });
      this.centerLabel(el);
    }
    if (o.frame !== undefined) {
      const f = o.frame === null ? null : this.frameOf(o.frame);
      this.setFrame(el, f);
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
      this.setFrame(k, frame);
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
    const t = this.add(
      this.textEl(text, box, author, fontSize, {
        frameId: frame?.id ?? null,
        ...(o.text_color !== undefined ? { strokeColor: textColor(o.text_color) } : {}),
      }),
    );
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
      spaced: 0,
      separated: 0,
      framesFitted: 0,
      framesMoved: 0,
    };
    const inScope = (fid: string | null | undefined) => !scope || scope.has(fid ?? null);
    const isBlock = (e: El) => this.isNode(e) || (e.type === "text" && !e.containerId);

    // 0. Bind loose arrow ends, so links survive every later move. Only where graph() already
    //    infers the edge (both ends on distinct nodes): tidy makes a connection explicit, never new.
    const nodes0 = this.live().filter((e) => this.isNode(e));
    for (const a of this.live()) {
      if (a.type !== "arrow" || !inScope(a.frameId) || (a.startBinding && a.endBinding)) continue;
      const pts = a.points as [number, number][];
      const end = (p: [number, number]) => this.nodeAt({ x: a.x + p[0], y: a.y + p[1] }, nodes0);
      const from = a.startBinding ? this.els.get(a.startBinding.elementId) : end(pts[0]);
      const to = a.endBinding ? this.els.get(a.endBinding.elementId) : end(pts[pts.length - 1]);
      if (!from || !to || from.id === to.id) continue;
      for (const [side, n] of [
        ["startBinding", from],
        ["endBinding", to],
      ] as const) {
        if (a[side]) continue;
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

    // Connections between siblings belong to that frame, even when their bends are outside it.
    for (const arrow of this.live()) {
      if (arrow.type !== "arrow") continue;
      const source = this.els.get(arrow.startBinding?.elementId);
      const target = this.els.get(arrow.endBinding?.elementId);
      const frame =
        source?.frameId && source.frameId === target?.frameId
          ? this.els.get(source.frameId)
          : undefined;
      if (frame && inScope(frame.id) && arrow.frameId !== frame.id) this.setFrame(arrow, frame);
    }

    // 2. Wrap notes that are far too wide.
    for (const e of this.live()) {
      if (e.type !== "text" || e.containerId || e.groupIds?.length || !inScope(e.frameId)) continue;
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

    const byFrame = this.tidyBlocks(inScope);

    // Steps 3-4 repeat until stable: a separation can unblock a snap that was refused before.
    for (let outer = 0; outer < 4; outer++) {
      const before = stats.aligned + stats.spaced + stats.separated;
      for (const blocks of byFrame.values()) {
        const others = (e: El) => blocks.filter((b) => b.node !== e).map((b) => b.box());
        // 3. Snap nodes whose centres are nearly in a row / column onto the cluster's largest box
        //    (a fixed anchor, so repeated runs converge). Never snap into a collision.
        const nodes = blocks.flatMap((b) => (b.node ? [b.node] : []));
        for (let round = 0; round < 4; round++) {
          let snapped = 0;
          for (const axis of ["y", "x"] as const) {
            const size = axis === "y" ? "height" : "width";
            const mid = (e: El) => e[axis] + e[size] / 2;
            for (const cluster of clusters(nodes, mid, 16)) {
              const anchor = cluster.reduce((m, e) =>
                e.width * e.height > m.width * m.height ? e : m,
              );
              for (const e of cluster) {
                const d = mid(anchor) - mid(e);
                if (e === anchor || Math.abs(d) < 1) continue;
                const box = { ...boxOf(e), [axis]: Math.round(e[axis] + d) } as Box;
                if (others(e).some((o) => overlaps(box, o, 23))) continue;
                this.moveNode(e, box);
                snapped++;
              }
            }
          }
          stats.aligned += snapped;
          if (!snapped) break;
        }

        // 3b. Even out the gaps along each aligned row / column.
        stats.spaced += this.spaceEvenly(nodes, others);

        // 4. Separate overlapping blocks with the smallest push; the later one (reading order)
        //    moves. When pushing sideways or down cost about the same, prefer fewer arrow crossings.
        const M = 24;
        for (let pass = 0; pass < 40; pass++) {
          let moved = false;
          const order = [...blocks].sort((a, b) => a.box().y - b.box().y || a.box().x - b.box().x);
          for (let i = 0; i < order.length; i++) {
            for (let j = i + 1; j < order.length; j++) {
              const a = order[i].box();
              const b = order[j].box();
              if (!overlaps(a, b, M - 1)) continue;
              const px = Math.round(Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + M);
              const py = Math.round(Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + M);
              const sideways = { dx: center(b).x >= center(a).x ? px : -px, dy: 0 };
              const down = { dx: 0, dy: py };
              let push = px < py ? sideways : down;
              const node = order[j].node;
              if (node && Math.abs(px - py) <= 48) {
                const cx = this.crossingsIf(node, sideways.dx, 0);
                const cy = this.crossingsIf(node, 0, down.dy);
                if (cx !== cy) push = cx < cy ? sideways : down;
              }
              order[j].move(push.dx, push.dy);
              stats.separated++;
              moved = true;
            }
          }
          if (!moved) break;
        }
      }
      if (stats.aligned + stats.spaced + stats.separated === before) break;
    }

    // 5. Fit frames around their contents, then 6. pull overlapping frames apart.
    //    Before routing, so connections are routed within the frames' final boxes.
    const frames = this.live().filter((f) => f.type === "frame" && inScope(f.id));
    for (const f of frames) if (this.fitFrame(f, true)) stats.framesFitted++;
    stats.framesMoved = this.separateFrames(
      scope ? [...this.grownFrames, ...frames.map((f) => f.id)] : frames.map((f) => f.id),
    );
    this.enforceBindings();

    // Repair: every bound arrow in scope is re-derived from its shapes (no-op when already right).
    for (const a of this.live()) {
      if (a.type === "arrow" && (a.startBinding || a.endBinding) && inScope(a.frameId))
        this.routeArrow(a);
    }

    // Detour: bend straight arrows (or our own earlier bends) around boxes they pass through.
    // Each choice weighs crossings with the other arrows, so repeat until no arrow changes its mind.
    const rerouted = new Set<string>();
    for (let round = 0; round < 4; round++) {
      let changed = false;
      for (const a of this.live()) {
        if (
          a.type === "arrow" &&
          (a.startBinding || a.endBinding) &&
          inScope(a.frameId) &&
          this.detour(a)
        ) {
          rerouted.add(a.id);
          changed = true;
        }
      }
      if (!changed) break;
    }
    stats.rerouted = rerouted.size;
    return stats;
  }

  /**
   * What tidy may move, per frame: nodes, notes, and each user group holding one of those as a
   * single rigid block, so grouped artwork stays intact. Icons are groups of parts but act as nodes.
   */
  private tidyBlocks(inScope: (fid: string | null | undefined) => boolean) {
    type Block = { node?: El; box: () => Box; move: (dx: number, dy: number) => void };
    const out = new Map<string | null, Block[]>();
    const add = (fid: string | null | undefined, b: Block) =>
      out.set(fid ?? null, [...(out.get(fid ?? null) ?? []), b]);
    const isBlock = (e: El) => this.isNode(e) || (e.type === "text" && !e.containerId);
    const live = this.live();
    // An icon's own group (parts + caption) is the icon node; only groups around it count.
    const seen = new Set(
      live.flatMap((e) => (e.customData?.icon && e.groupIds?.length === 1 ? e.groupIds : [])),
    );
    for (const e of live) {
      if (!inScope(e.frameId) || e.customData?.componentPart) continue;
      const gid = e.groupIds?.at(-1);
      if (!gid || (e.customData?.icon && e.groupIds.length === 1)) {
        if (!isBlock(e)) continue;
        add(e.frameId, {
          node: this.isNode(e) ? e : undefined,
          box: () => boxOf(e),
          move: (dx, dy) =>
            this.isNode(e)
              ? this.moveNode(e, { ...boxOf(e), x: e.x + dx, y: e.y + dy })
              : this.mutate(e, { x: e.x + dx, y: e.y + dy }),
        });
        continue;
      }
      if (seen.has(gid)) continue;
      seen.add(gid);
      const members = live.filter((m) => m.groupIds?.includes(gid));
      if (!members.some(isBlock)) continue; // a pure sketch: left alone, like ungrouped ones
      const ids = new Set(members.map((m) => m.id));
      const labels = members.flatMap((m) => {
        const t = this.boundText(m);
        return t && !ids.has(t.id) ? [t] : [];
      });
      add(e.frameId, {
        box: () => unionBox(members.map(boxOf))!,
        move: (dx, dy) => {
          for (const m of [...members, ...labels]) this.mutate(m, { x: m.x + dx, y: m.y + dy });
          for (const m of members)
            for (const a of this.arrowsBoundTo(m.id)) if (!ids.has(a.id)) this.routeArrow(a);
        },
      });
    }
    return out;
  }

  /**
   * Even out the gaps between nodes in each aligned row (and column) of three or more, when
   * they are already roughly even (widest gap at most 3x the narrowest). The ends stay put, and
   * so does any node that also sits in an aligned column (row), splitting the run around it.
   */
  private spaceEvenly(nodes: El[], others: (e: El) => Box[]): number {
    let moved = 0;
    for (const axis of ["y", "x"] as const) {
      const size = axis === "y" ? "height" : "width";
      const along = axis === "y" ? "x" : "y";
      const len = axis === "y" ? "width" : "height";
      const mid = (e: El) => e[axis] + e[size] / 2;
      const across = (e: El) => e[along] + e[len] / 2;
      const pinned = (e: El) => nodes.some((o) => o !== e && Math.abs(across(o) - across(e)) <= 1);
      for (const row of clusters(nodes, mid, 1)) {
        row.sort((a, b) => a[along] - b[along]);
        const runs: El[][] = [[row[0]]];
        for (const e of row.slice(1)) {
          runs.at(-1)!.push(e);
          if (pinned(e)) runs.push([e]);
        }
        for (const run of runs) {
          if (run.length < 3) continue;
          const gaps = run.slice(1).map((e, i) => e[along] - (run[i][along] + run[i][len]));
          const lo = Math.min(...gaps);
          const hi = Math.max(...gaps);
          if (lo <= 0 || hi > 3 * lo || hi - lo <= 2) continue;
          const even = gaps.reduce((a, b) => a + b, 0) / gaps.length;
          let widths = 0;
          for (let i = 1; i < run.length - 1; i++) {
            const e = run[i];
            widths += run[i - 1][len];
            const target = Math.round(run[0][along] + widths + i * even);
            if (target === e[along]) continue;
            const box = { ...boxOf(e), [along]: target } as Box;
            if (others(e).some((o) => overlaps(box, o, 23))) continue;
            this.moveNode(e, box);
            moved++;
          }
        }
      }
    }
    return moved;
  }

  /** Arrow crossings a node's connections would have after moving it by (dx, dy), as straight legs. */
  private crossingsIf(node: El, dx: number, dy: number): number {
    const c = center(boxOf(node));
    const from = { x: c.x + dx, y: c.y + dy };
    const mine = this.arrowsBoundTo(node.id);
    const legs = mine.flatMap((a) => {
      const other = this.els.get(
        a.startBinding?.elementId === node.id ? a.endBinding?.elementId : a.startBinding?.elementId,
      );
      return other && !other.isDeleted ? [center(boxOf(other))] : [];
    });
    if (!legs.length) return 0;
    const ids = new Set(mine.map((a) => a.id));
    let n = 0;
    for (const a of this.live()) {
      if (a.type !== "arrow" || ids.has(a.id)) continue;
      const pts = (a.points as [number, number][]).map(([px, py]) => ({
        x: a.x + px,
        y: a.y + py,
      }));
      for (let i = 1; i < pts.length; i++)
        for (const to of legs) if (segmentsCross(from, to, pts[i - 1], pts[i])) n++;
    }
    return n;
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
      if (author === "agent" && el.type !== "text" && el.strokeColor !== "transparent")
        el.strokeColor = AGENT_STROKE;
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
    const live = this.live().filter((e) => !e.customData?.componentPart);
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
    const hit = (p: Pt) => this.nodeAt(p, nodes);

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
        const labelEl = this.boundText(e);
        const label = labelEl?.text;
        edges.push({
          id: e.id,
          from: display(from),
          to: display(to),
          fromId: from.id,
          toId: to.id,
          ...(label ? { label } : {}),
          ...reportTextColor(labelEl),
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
        ...((n.customData?.iconFill ?? n.backgroundColor) &&
        (n.customData?.iconFill ?? n.backgroundColor) !== "transparent"
          ? {
              color:
                COLOR_NAMES[n.customData?.iconFill ?? n.backgroundColor] ??
                n.customData?.iconFill ??
                n.backgroundColor,
            }
          : {}),
        ...reportTextColor(this.boundText(n)),
        ...(n.customData?.icon ? { icon: n.customData.icon } : {}),
        ...(n.customData?.kind ? { kind: n.customData.kind } : {}),
        ...(n.customData?.author === "agent" ? { by: "agent" } : {}),
        ...(sel?.has(n.id) ? { selected: true } : {}),
      })),
      edges: edges.map(({ fromId: _fromId, toId: _toId, ...rest }) => ({
        ...rest,
        ...(sel?.has(rest.id) ? { selected: true } : {}),
      })),
      notes: live
        .filter((e) => e.type === "text" && !e.containerId && !e.customData?.componentLabel)
        .map((t) => ({
          id: t.id,
          text: t.text,
          x: Math.round(t.x),
          y: Math.round(t.y),
          ...(t.frameId ? { frame: frameName(t.frameId) } : {}),
          ...reportTextColor(t),
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
