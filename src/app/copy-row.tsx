import { useState } from "react";

interface CopyRowProps {
  label?: string;
  text: string;
}

export function CopyRow({ label, text }: CopyRowProps) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className="row">
      {label && <span className="copy-label">{label}</span>}
      <code className="cmd">{text}</code>
      <button
        type="button"
        onClick={() => {
          setFailed(false);
          navigator.clipboard
            .writeText(text)
            .then(() => {
              setCopied(true);

              return setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => {
              setFailed(true);
            });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      {failed && <span role="alert">Could not copy. Select and copy the text manually.</span>}
    </div>
  );
}
