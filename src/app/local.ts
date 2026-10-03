import { assertBoundary, isLibrary, isText, type Guard, type LibraryEntry } from "./validation.ts";

export type { LibraryEntry } from "./validation.ts";
// Per-browser convenience: the diagram library (links you've opened).

const LIB = "sdc.library";

function read<T>(k: string, fallback: T, guard: Guard<T>): T {
  try {
    const v = localStorage.getItem(k);

    if (!v) return fallback;
    const parsed: unknown = JSON.parse(v);
    assertBoundary(parsed, guard);

    return parsed;
  } catch {
    return fallback;
  }
}

function write(k: string, v: string | LibraryEntry[]) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

export const library = () =>
  read<LibraryEntry[]>(LIB, [], isLibrary).toSorted((a, b) => b.openedAt - a.openedAt);

export function remember(e: Omit<LibraryEntry, "openedAt">) {
  write(LIB, [{ ...e, openedAt: Date.now() }, ...library().filter((x) => x.id !== e.id)]);
}

export function forget(id: string) {
  write(
    LIB,
    library().filter((x) => x.id !== id),
  );
}

export const mcpUrl = () => `${location.origin}/mcp`;

export const setupCommands = () => [
  { client: "Claude Code", cmd: `claude mcp add --transport http system-design ${mcpUrl()}` },
  { client: "Codex", cmd: `codex mcp add system-design --url ${mcpUrl()}` },
];

export const linkFor = (id: string, key: string) => `${location.origin}/d/${id}?k=${key}`;

/** Name shown on this browser's cursor for other people on the board. */
const NAME = "sdc.name";

export const displayName = () => read<string>(NAME, "", isText);

export const setDisplayName = (name: string) => write(NAME, name.trim().slice(0, 40));
