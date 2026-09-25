// Per-browser convenience: the diagram library (links you've opened).

export interface LibraryEntry {
  id: string;
  key: string;
  name: string;
  openedAt: number;
}

const LIB = "sdc.library";

function read<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

export const library = () =>
  read<LibraryEntry[]>(LIB, []).toSorted((a, b) => b.openedAt - a.openedAt);

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
export const displayName = () => read<string>(NAME, "");
export const setDisplayName = (name: string) => write(NAME, name.trim().slice(0, 40));
