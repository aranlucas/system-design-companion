// Scene engine: semantic ops ⇄ Excalidraw elements. Pure logic, no Workers APIs.
import dagre from "@dagrejs/dagre";
import { generateKeyBetween } from "fractional-indexing";
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
      label: string;
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

export function measureText(text: string, fontSize: number) {
  const lines = text.split("\n");
  const longest = Math.max(...lines.map((l) => l.length), 1);
  return { width: Math.ceil(longest * fontSize * CHAR_W), height: Math.ceil(lines.length * fontSize * LINE_HEIGHT) };
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
function borderPoint(b: Box, toward: { x: number; y: number }, gap: number) {
  const c = center(b);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const tx = dx !== 0 ? (b.w / 2 + gap) / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? (b.h / 2 + gap) / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

export class Scene {
  els: Map<string, El>;
  private changed = new Set<string>();
  private refs = new Map<string, string>();
  private lastPlaced: string | null = null;

  constructor(elements: Iterable<El>) {
    this.els = new Map([...elements].map((e) => [e.id, e]));
  }

  // ---------- basics ----------

  live(): El[] {
    return [...this.els.values()]
      .filter((e) => !e.isDeleted)
      .sort((a, b) => ((a.index ?? "") < (b.index ?? "") ? -1 : (a.index ?? "") > (b.index ?? "") ? 1 : 0));
  }

  changedElements(): El[] {
    this.fixLabelOrder();
    return [...this.changed]
      .map((id) => this.els.get(id)!)
      .filter(Boolean)
      .sort((a, b) => ((a.index ?? "") < (b.index ?? "") ? -1 : (a.index ?? "") > (b.index ?? "") ? 1 : 0));
  }

  /** Excalidraw invariant: a bound text must sit above its container in z-order. */
  private fixLabelOrder() {
    for (const id of [...this.changed]) {
      const t = this.els.get(id);
      if (!t || t.type !== "text" || !t.containerId || t.isDeleted) continue;
      const c = this.els.get(t.containerId);
      if (c && c.index && t.index && t.index <= c.index) this.mutate(t, { index: generateKeyBetween(this.maxIndex(), null) });
    }
  }

  private maxIndex(): string | null {
    let max: string | null = null;
    for (const e of this.els.values()) if (e.index && (max === null || e.index > max)) max = e.index;
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

  private textEl(text: string, box: Box, author: Author, fontSize: number, extra: Partial<El> = {}): El {
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
    for (const e of this.els.values()) if (!e.isDeleted && e.type === "text" && e.containerId === container.id) return e;
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
      throw new Error(`"${target}" is ambiguous (${matches.length} matches: ${matches.map((m) => m.id).join(", ")}); use an id`);
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
      .filter((e) => !exclude.has(e.id) && e.type !== "frame" && e.type !== "arrow" && !(e.type === "text" && e.containerId))
      .map(boxOf);
  }

  sceneBounds(): Box | null {
    return unionBox(this.live().filter((e) => e.type !== "arrow").map(boxOf));
  }

  private place(spec: Placement | undefined, w: number, h: number, frame: El | null, exclude = new Set<string>()): Box {
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
      if (axis === "y") box = { ...box, y: box.y + h + 40 };
      else {
        box = { ...box, x: box.x + w + 40 };
        if (frame && box.x + w > frame.x + frame.width - PAD) box = { ...box, x: frame.x + PAD, y: box.y + h + 40 };
      }
    }
    return { x: Math.round(box.x), y: Math.round(box.y), w, h };
  }

  /** Grow a frame so it encloses all its children. */
  private fitFrame(frame: El) {
    const kids = this.live().filter((e) => e.frameId === frame.id).map(boxOf);
    const u = unionBox(kids);
    if (!u) return;
    const nx = Math.min(frame.x, u.x - PAD);
    const ny = Math.min(frame.y, u.y - PAD);
    const nr = Math.max(frame.x + frame.width, u.x + u.w + PAD);
    const nb = Math.max(frame.y + frame.height, u.y + u.h + PAD);
    if (nx !== frame.x || ny !== frame.y || nr !== frame.x + frame.width || nb !== frame.y + frame.height) {
      this.mutate(frame, { x: nx, y: ny, width: nr - nx, height: nb - ny });
    }
  }

  // ---------- geometry maintenance ----------

  private centerLabel(container: El) {
    const t = this.boundText(container);
    if (!t) return;
    if (container.type === "arrow") {
      const pts = container.points as [number, number][];
      const a = pts[0];
      const b = pts[pts.length - 1];
      const mx = container.x + (a[0] + b[0]) / 2;
      const my = container.y + (a[1] + b[1]) / 2;
      this.mutate(t, { x: Math.round(mx - t.width / 2), y: Math.round(my - t.height / 2) });
    } else {
      const c = center(boxOf(container));
      this.mutate(t, { x: Math.round(c.x - t.width / 2), y: Math.round(c.y - t.height / 2), frameId: container.frameId ?? null });
    }
  }

  private arrowsBoundTo(id: string): El[] {
    return this.live().filter(
      (e) => (e.type === "arrow" || e.type === "line") && (e.startBinding?.elementId === id || e.endBinding?.elementId === id),
    );
  }

  private routeArrow(arrow: El) {
    const pts = arrow.points as [number, number][];
    const absStart = { x: arrow.x + pts[0][0], y: arrow.y + pts[0][1] };
    const absEnd = { x: arrow.x + pts[pts.length - 1][0], y: arrow.y + pts[pts.length - 1][1] };
    const s = arrow.startBinding ? this.els.get(arrow.startBinding.elementId) : undefined;
    const t = arrow.endBinding ? this.els.get(arrow.endBinding.elementId) : undefined;
    const sc = s ? center(boxOf(s)) : absStart;
    const tc = t ? center(boxOf(t)) : absEnd;
    const start = s ? borderPoint(boxOf(s), tc, 8) : absStart;
    const end = t ? borderPoint(boxOf(t), sc, 8) : absEnd;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    this.mutate(arrow, {
      x: Math.round(start.x),
      y: Math.round(start.y),
      points: [
        [0, 0],
        [Math.round(dx), Math.round(dy)],
      ],
      width: Math.abs(Math.round(dx)),
      height: Math.abs(Math.round(dy)),
    });
    this.centerLabel(arrow);
  }

  /** Move a node (and its label) and re-route attached arrows. */
  private moveNode(el: El, box: Box) {
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
    this.mutate(container, { boundElements: container.boundElements.filter((b: any) => b.id !== id) });
  }

  private setLabel(container: El, label: string, author: Author) {
    const existing = this.boundText(container);
    const fontSize = existing?.fontSize ?? (container.type === "arrow" ? 16 : 20);
    const m = measureText(label, fontSize);
    if (existing) {
      this.mutate(existing, { text: label, originalText: label, width: m.width, height: m.height });
    } else {
      const t = this.add(
        this.textEl(label, { x: container.x, y: container.y, w: m.width, h: m.height }, author, fontSize, {
          containerId: container.id,
          frameId: container.frameId ?? null,
        }),
      );
      this.addBound(container, { id: t.id, type: "text" });
    }
    if (container.type !== "arrow") {
      const w = Math.max(container.width, m.width + PAD);
      const h = Math.max(container.height, m.height + PAD);
      if (w !== container.width || h !== container.height) this.moveNode(container, { x: container.x, y: container.y, w, h });
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
      for (const k of this.live().filter((e) => e.frameId === el.id)) this.mutate(k, { frameId: null });
    }
  }

  // ---------- ops ----------

  private setRef(ref: string | undefined, id: string) {
    if (ref) this.refs.set(ref, id);
  }

  addNode(o: Extract<Op, { op: "add_node" }>, author: Author): El {
    const frame = this.frameOf(o.frame);
    const m = measureText(o.label, 20);
    const w = Math.max(o.width ?? NODE_MIN_W, m.width + PAD);
    const h = Math.max(o.height ?? NODE_MIN_H, m.height + PAD);
    const box = this.place(o.place, w, h, frame);
    const shape = o.shape ?? "rectangle";
    const node = this.add(
      this.base(shape, box, author, {
        backgroundColor: o.color ? (COLORS[o.color] ?? o.color) : "transparent",
        roundness: shape === "rectangle" ? { type: 3 } : shape === "diamond" ? { type: 2 } : null,
        frameId: frame?.id ?? null,
      }),
    );
    this.setLabel(node, o.label, author);
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
        const m = measureText(o.label, el.fontSize ?? 20);
        this.mutate(el, { text: o.label, originalText: o.label, width: m.width, height: m.height });
      } else this.setLabel(el, o.label, author);
    }
    if (o.color !== undefined) this.mutate(el, { backgroundColor: COLORS[o.color] ?? o.color });
    if (o.dashed !== undefined) this.mutate(el, { strokeStyle: o.dashed ? "dashed" : "solid" });
    if (o.shape && SHAPE_TYPES.has(el.type)) {
      this.mutate(el, { type: o.shape, roundness: o.shape === "rectangle" ? { type: 3 } : o.shape === "diamond" ? { type: 2 } : null });
    }
    if (o.frame !== undefined) {
      const f = o.frame === null ? null : this.frameOf(o.frame);
      this.mutate(el, { frameId: f?.id ?? null });
      const t = this.boundText(el);
      if (t) this.mutate(t, { frameId: f?.id ?? null });
      if (f && !o.move) {
        const inside = el.x >= f.x && el.y >= f.y && el.x + el.width <= f.x + f.width && el.y + el.height <= f.y + f.height;
        if (!inside) this.moveNode(el, this.place(undefined, el.width, el.height, f, new Set([el.id])));
      }
      if (f) this.fitFrame(f);
    }
    if (o.move || o.width || o.height) {
      const w = o.width ?? el.width;
      const h = o.height ?? el.height;
      const box = o.move ? this.place(o.move, w, h, null, new Set([el.id])) : { x: el.x, y: el.y, w, h };
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
    const frame = this.add(this.base("frame", box, author, { name: o.name, strokeColor: "#bbb", roughness: 0 }));
    for (const k of kids) {
      this.mutate(k, { frameId: frame.id });
      const t = this.boundText(k);
      if (t) this.mutate(t, { frameId: frame.id });
    }
    this.setRef(o.ref, frame.id);
    return frame;
  }

  addNote(o: Extract<Op, { op: "add_note" }>, author: Author): El {
    const frame = this.frameOf(o.frame);
    const fontSize = { s: 16, m: 20, l: 28 }[o.size ?? "m"];
    const m = measureText(o.text, fontSize);
    const box = this.place(o.place, m.width, m.height, frame);
    const t = this.add(this.textEl(o.text, box, author, fontSize, { frameId: frame?.id ?? null }));
    if (frame) this.fitFrame(frame);
    this.setRef(o.ref, t.id);
    return t;
  }

  apply(ops: Op[], author: Author): OpResult[] {
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

  // ---------- bulk ----------

  /** Auto-layout nodes with dagre. Scope: a frame (its children) or all top-level nodes. */
  layout(direction: "LR" | "TB", scopeFrame?: string) {
    const frame = this.frameOf(scopeFrame);
    const nodes = this.live().filter((e) => this.isNode(e) && (frame ? e.frameId === frame.id : !e.frameId));
    if (!nodes.length) throw new Error("nothing to lay out");
    const ids = new Set(nodes.map((n) => n.id));
    const before = unionBox(nodes.map(boxOf))!;
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 120, marginx: 0, marginy: 0 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height });
    for (const e of this.graph()._edgesRaw) if (ids.has(e.fromId ?? "") && ids.has(e.toId ?? "")) g.setEdge(e.fromId!, e.toId!);
    dagre.layout(g);
    for (const n of nodes) {
      const p = g.node(n.id);
      this.moveNode(n, { x: Math.round(before.x + p.x - n.width / 2), y: Math.round(before.y + p.y - n.height / 2), w: n.width, h: n.height });
    }
    if (frame) this.fitFrame(frame);
    return nodes.length;
  }

  /** Add externally-converted elements (e.g. from Mermaid) as a block placed in free space. */
  addForeign(elements: El[], author: Author) {
    const live = elements
      .filter((e) => !e.isDeleted)
      .sort((a, b) => ((a.index ?? "") < (b.index ?? "") ? -1 : (a.index ?? "") > (b.index ?? "") ? 1 : 0));
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
    const frameName = (id: string | null | undefined) => (id ? (this.els.get(id)?.name ?? id) : undefined);
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
      nodes.find((n) => p.x >= n.x - 25 && p.x <= n.x + n.width + 25 && p.y >= n.y - 25 && p.y <= n.y + n.height + 25);

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
    const sketches: { id: string; type: string; x: number; y: number; w: number; h: number; frame?: string }[] = [];

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
        to = hit({ x: e.x + pts[pts.length - 1][0], y: e.y + pts[pts.length - 1][1] });
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
        sketches.push({ id: e.id, type: e.type, x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.width), h: Math.round(e.height), frame: frameName(e.frameId) });
      }
    }
    for (const e of live) {
      if (e.type === "freedraw" || e.type === "image") {
        sketches.push({ id: e.id, type: e.type, x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.width), h: Math.round(e.height), frame: frameName(e.frameId) });
      }
    }

    const sel = selection && selection.size ? selection : undefined;
    return {
      frames: frames.map((f) => ({ id: f.id, name: f.name ?? "", x: Math.round(f.x), y: Math.round(f.y), w: Math.round(f.width), h: Math.round(f.height) })),
      nodes: nodes.map((n) => ({
        id: n.id,
        label: this.labelOf(n),
        shape: n.type,
        x: Math.round(n.x),
        y: Math.round(n.y),
        w: Math.round(n.width),
        h: Math.round(n.height),
        ...(n.frameId ? { frame: frameName(n.frameId) } : {}),
        ...(n.backgroundColor && n.backgroundColor !== "transparent" ? { color: COLOR_NAMES[n.backgroundColor] ?? n.backgroundColor } : {}),
        ...(n.customData?.author === "agent" ? { by: "agent" } : {}),
        ...(sel?.has(n.id) ? { selected: true } : {}),
      })),
      edges: edges.map(({ fromId, toId, ...rest }) => ({ ...rest, ...(sel?.has(rest.id) ? { selected: true } : {}) })),
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
