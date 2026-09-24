import { componentByKind } from "../shared/components.ts";
import type { Op, Scene } from "./scene.ts";

const compact = (value: string, limit: number) => {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};

/** Snapshots contain the state BEFORE the requested edit, not its result. */
export function patchSnapshotName(ops: Op[], scene: Scene, summary?: string): string {
  if (summary?.trim()) return `Before: ${compact(summary, 120)}`;
  const refs = new Map<string, string>();
  const label = (target: string) => {
    if (refs.has(target)) return refs.get(target)!;
    try {
      return compact(scene.labelOf(scene.resolve(target)) || target, 40);
    } catch {
      return compact(target, 40);
    }
  };
  const descriptions = ops.map((op) => {
    switch (op.op) {
      case "add_node": {
        const name = compact(op.label || componentByKind.get(op.kind ?? "")?.label || "node", 40);
        if (op.ref) refs.set(op.ref, name);
        return `Add ${name}`;
      }
      case "add_frame":
        if (op.ref) refs.set(op.ref, compact(op.name, 40));
        return `Add ${compact(op.name, 40)} frame`;
      case "add_note":
        if (op.ref) refs.set(op.ref, compact(op.text, 40));
        return `Add note: ${compact(op.text, 40)}`;
      case "connect":
        return `Connect ${label(op.from)} → ${label(op.to)}`;
      case "disconnect":
        return `Disconnect ${label(op.from)} → ${label(op.to)}`;
      case "remove":
        return `Remove ${label(op.target)}`;
      case "update":
        return op.label
          ? `Rename ${label(op.target)} to ${compact(op.label, 40)}`
          : `${op.move ? "Move" : "Update"} ${label(op.target)}`;
    }
  });
  const unique = [...new Set(descriptions)];
  const extra = unique.length > 2 ? ` (+${unique.length - 2} more)` : "";
  return `Before: ${unique.slice(0, 2).join("; ") || "diagram edit"}${extra}`;
}
