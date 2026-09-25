import { useState } from "react";

interface CopyRowProps {
  label?: string;
  text: string;
}

export function CopyRow({ label, text }: CopyRowProps) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="row">
      {label && <span className="copy-label">{label}</span>}
      <code className="cmd">{text}</code>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
