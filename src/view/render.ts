// Draws Excalidraw elements as a static, hand-drawn SVG (rough.js), without bundling Excalidraw.
import rough from "roughjs";
import type { Options } from "roughjs/bin/core";
import type { El } from "../shared/protocol.ts";

const SVG_NS = "http://www.w3.org/2000/svg";
const PAD = 24;
const HAND = `Excalifont, "Chalkboard SE", "Comic Sans MS", "Segoe Print", cursive`;
const FONTS: Record<number, string> = {
  1: HAND,
  2: `Helvetica, Arial, sans-serif`,
  3: `"Cascadia Code", Menlo, monospace`,
  5: HAND,
  6: `Nunito, system-ui, sans-serif`,
  8: `"Comic Shanns", "Comic Sans MS", cursive`,
};

type Pt = [number, number];

function node<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

const absPoints = (e: El): Pt[] =>
  ((e.points as Pt[] | undefined) ?? [[0, 0]]).map(([px, py]) => [e.x + px, e.y + py]);

function bounds(els: El[]) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const e of els) {
    const pts: Pt[] =
      e.type === "arrow" || e.type === "line" || e.type === "freedraw"
        ? absPoints(e)
        : [
            [e.x, e.y],
            [e.x + e.width, e.y + e.height],
          ];
    if (e.type === "frame") pts.push([e.x, e.y - 24]); // frame title sits above the frame
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return { x: x0 - PAD, y: y0 - PAD, w: x1 - x0 + PAD * 2, h: y1 - y0 + PAD * 2 };
}

function roughOptions(e: El): Options {
  const sw = e.strokeWidth ?? 2;
  const filled = e.backgroundColor && e.backgroundColor !== "transparent";
  return {
    seed: e.seed ?? 1,
    roughness: e.roughness ?? 1,
    stroke: e.strokeColor ?? "#1e1e1e",
    strokeWidth: sw,
    fill: filled ? e.backgroundColor : undefined,
    fillStyle: e.fillStyle === "cross-hatch" ? "cross-hatch" : (e.fillStyle ?? "hachure"),
    fillWeight: sw / 2,
    hachureGap: sw * 4,
    strokeLineDash:
      e.strokeStyle === "dashed"
        ? [8, 8 + sw]
        : e.strokeStyle === "dotted"
          ? [1.5, 6 + sw]
          : undefined,
    disableMultiStroke: e.strokeStyle !== "solid",
    preserveVertices: (e.roughness ?? 1) < 2,
  };
}

/** Excalidraw's corner radius for rounded rectangles (adaptive = type 3, proportional = type 2). */
function cornerRadius(e: El) {
  const x = Math.min(e.width, e.height);
  if (e.roundness?.type === 3) return x <= 128 ? x * 0.25 : 32;
  return x * 0.25;
}

function roundedRectPath(x: number, y: number, w: number, h: number, r: number) {
  return `M ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${y + h - r} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y}`;
}

function arrowhead(
  rc: ReturnType<typeof rough.svg>,
  kind: string,
  tip: Pt,
  from: Pt,
  o: Options,
): SVGGElement[] {
  const [tx, ty] = tip;
  const len = Math.hypot(tx - from[0], ty - from[1]) || 1;
  const size = Math.min(kind === "arrow" ? 30 : 15, len / 2);
  const ux = (tx - from[0]) / len;
  const uy = (ty - from[1]) / len;
  const wing = (deg: number): Pt => {
    const a = (deg * Math.PI) / 180;
    return [
      tx - size * (ux * Math.cos(a) - uy * Math.sin(a)),
      ty - size * (uy * Math.cos(a) + ux * Math.sin(a)),
    ];
  };
  const plain = { ...o, fill: undefined, strokeLineDash: undefined };
  switch (kind) {
    case "triangle":
    case "triangle_outline":
      return [
        rc.polygon([tip, wing(25), wing(-25)], {
          ...plain,
          fill: kind === "triangle" ? o.stroke : undefined,
          fillStyle: "solid",
        }),
      ];
    case "dot":
    case "circle":
    case "circle_outline":
      return [
        rc.circle(tx, ty, size, {
          ...plain,
          fill: kind === "circle_outline" ? undefined : o.stroke,
          fillStyle: "solid",
        }),
      ];
    case "bar":
      return [rc.line(...wing(90), ...wing(-90), plain)];
    default:
      return [rc.linearPath([wing(20), tip, wing(-20)], plain)];
  }
}

/** Midpoint along a polyline, used to centre arrow labels. */
function midpoint(pts: Pt[]): Pt {
  const segs = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  let half = segs.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < segs.length; i++) {
    if (half <= segs[i]) {
      const t = segs[i] ? half / segs[i] : 0;
      return [
        pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
      ];
    }
    half -= segs[i];
  }
  return pts[0];
}

function drawText(e: El, byId: Map<string, El>, fits: (() => void)[]): SVGGElement {
  const g = node("g");
  const fontSize = e.fontSize ?? 20;
  const lh = fontSize * (e.lineHeight ?? 1.25);
  const lines = String(e.text ?? "").split("\n");
  const container = e.containerId ? byId.get(e.containerId) : undefined;

  // Bound labels are positioned by the canvas tab, which may be closed, so centre them ourselves.
  let anchor: "start" | "middle" | "end" = "start";
  let x = e.x;
  let top = e.y;
  if (container) {
    const [cx, cy] =
      container.type === "arrow" || container.type === "line"
        ? midpoint(absPoints(container))
        : [container.x + container.width / 2, container.y + container.height / 2];
    anchor = "middle";
    x = cx;
    top = cy - (lines.length * lh) / 2;
    if (container.type === "arrow" || container.type === "line")
      g.append(
        node("rect", {
          x: cx - e.width / 2 - 4,
          y: top - 2,
          width: e.width + 8,
          height: lines.length * lh + 4,
          fill: "#ffffff",
        }),
      );
  } else if (e.textAlign === "center") {
    anchor = "middle";
    x = e.x + e.width / 2;
  } else if (e.textAlign === "right") {
    anchor = "end";
    x = e.x + e.width;
  }

  const text = node("text", {
    "font-family": FONTS[e.fontFamily as number] ?? HAND,
    "font-size": fontSize,
    fill: e.strokeColor ?? "#1e1e1e",
    "text-anchor": anchor,
    "dominant-baseline": "middle",
  });
  lines.forEach((line, i) => {
    const span = node("tspan", { x, y: top + lh * i + lh / 2 });
    span.textContent = line;
    text.append(span);
  });
  g.append(text);

  // If a fallback font is wider than the one the layout was measured with, squeeze it to fit.
  const max = container && container.type !== "arrow" ? container.width - 10 : e.width;
  fits.push(() => {
    for (const span of text.querySelectorAll("tspan")) {
      const w = span.getComputedTextLength();
      if (max > 0 && w > max * 1.02) {
        span.setAttribute("textLength", String(max));
        span.setAttribute("lengthAdjust", "spacingAndGlyphs");
      }
    }
  });
  return g;
}

function drawFrame(e: El): SVGGElement {
  const g = node("g");
  g.append(
    node("rect", {
      x: e.x,
      y: e.y,
      width: e.width,
      height: e.height,
      rx: 8,
      fill: "none",
      stroke: "#bbb",
      "stroke-width": 1,
    }),
  );
  const label = node("text", {
    x: e.x + 4,
    y: e.y - 8,
    "font-family": "system-ui, sans-serif",
    "font-size": 14,
    fill: "#868e96",
  });
  label.textContent = e.name ?? "Frame";
  g.append(label);
  return g;
}

function drawShape(rc: ReturnType<typeof rough.svg>, e: El): SVGGElement | SVGGElement[] | null {
  const o = roughOptions(e);
  const { x, y, width: w, height: h } = e;
  switch (e.type) {
    case "rectangle":
      return e.roundness
        ? rc.path(roundedRectPath(x, y, w, h, cornerRadius(e)), o)
        : rc.rectangle(x, y, w, h, o);
    case "ellipse":
      return rc.ellipse(x + w / 2, y + h / 2, w, h, o);
    case "diamond":
      return rc.polygon(
        [
          [x + w / 2, y],
          [x + w, y + h / 2],
          [x + w / 2, y + h],
          [x, y + h / 2],
        ],
        o,
      );
    case "arrow":
    case "line": {
      const pts = absPoints(e);
      if (pts.length < 2) return null;
      const line =
        e.roundness && !e.elbowed && pts.length > 2
          ? rc.curve(pts, { ...o, fill: undefined })
          : rc.linearPath(pts, { ...o, fill: undefined });
      const out = [line];
      if (e.endArrowhead) out.push(...arrowhead(rc, e.endArrowhead, pts.at(-1)!, pts.at(-2)!, o));
      if (e.startArrowhead) out.push(...arrowhead(rc, e.startArrowhead, pts[0], pts[1], o));
      return out;
    }
    case "freedraw": {
      const pts = absPoints(e);
      const path = node("path", {
        d: `M ${pts.map(([px, py]) => `${px} ${py}`).join(" L ")}`,
        fill: "none",
        stroke: e.strokeColor ?? "#1e1e1e",
        "stroke-width": (e.strokeWidth ?? 2) * 1.5,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      });
      const g = node("g");
      g.append(path);
      return g;
    }
    case "image":
    case "embeddable":
    case "iframe":
      return rc.rectangle(x, y, w, h, { ...o, stroke: "#adb5bd", strokeLineDash: [6, 6] });
    default:
      return null;
  }
}

async function fitWhenFontsLoad(fits: (() => void)[]) {
  await document.fonts.ready;
  for (const fit of fits) fit();
}

/** Replace the contents of `svg` with a drawing of `elements` (already in z-order, non-deleted). */
export function renderScene(svg: SVGSVGElement, elements: El[]) {
  svg.replaceChildren();
  const els = elements.filter((e) => !e.isDeleted);
  if (!els.length) return;
  const byId = new Map(els.map((e) => [e.id, e]));
  const b = bounds(els);
  svg.setAttribute("viewBox", `${b.x} ${b.y} ${b.w} ${b.h}`);
  svg.dataset.aspect = String(b.w / b.h);
  svg.append(node("rect", { x: b.x, y: b.y, width: b.w, height: b.h, fill: "#ffffff" }));

  const rc = rough.svg(svg);
  const fits: (() => void)[] = [];
  // Frames go underneath everything, like Excalidraw.
  for (const e of els) if (e.type === "frame" || e.type === "magicframe") svg.append(drawFrame(e));
  for (const e of els) {
    if (e.type === "frame" || e.type === "magicframe") continue;
    const drawn = e.type === "text" ? drawText(e, byId, fits) : drawShape(rc, e);
    if (!drawn) continue;
    const g = node("g");
    g.append(...(Array.isArray(drawn) ? drawn : [drawn]));
    if ((e.opacity ?? 100) < 100) g.setAttribute("opacity", String(e.opacity / 100));
    if (e.angle)
      g.setAttribute(
        "transform",
        `rotate(${(e.angle * 180) / Math.PI} ${e.x + e.width / 2} ${e.y + e.height / 2})`,
      );
    svg.append(g);
  }
  void fitWhenFontsLoad(fits);
}
