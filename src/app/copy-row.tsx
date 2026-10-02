import { useEffect, useRef, useState } from "react";

interface CopyRowProps {
  label?: string;
  text: string;
}

export function CopyRow({ label, text }: CopyRowProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div className="row copy-row">
      {label && <span className="copy-label">{label}</span>}
      <code className="cmd">{text}</code>
      <button
        type="button"
        aria-label={label ? `Copy ${label} command` : "Copy text"}
        onClick={async () => {
          if (timer.current) clearTimeout(timer.current);
          try {
            await navigator.clipboard.writeText(text);
            setState("copied");
            timer.current = setTimeout(() => setState("idle"), 1500);
          } catch {
            setState("failed");
          }
        }}
      >
        {state === "copied" ? "Copied" : "Copy"}
      </button>
      {state === "failed" && (
        <p role="alert" className="copy-error">
          Clipboard access is unavailable. Select the text and copy it manually.
        </p>
      )}
      <output className="sr-only">{state === "copied" ? `${label ?? "Text"} copied` : ""}</output>
    </div>
  );
}
