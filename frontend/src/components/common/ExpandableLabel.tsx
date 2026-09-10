import { useState } from "react";
import { truncateDisplayText } from "../../lib/truncateDisplayText";

type Props = {
  text: string;
  max?: number;
  className?: string;
  title?: string;
};

/** Shows a short preview; click expands the rest. */
export function ExpandableLabel({ text, max = 28, className, title }: Props) {
  const [open, setOpen] = useState(false);
  const trimmed = text.replace(/\s+/g, " ").trim();
  const { preview, truncated } = truncateDisplayText(trimmed, max);

  if (!truncated) {
    return (
      <span className={className} title={title || trimmed}>
        {trimmed}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`expandable-label ${className || ""}`.trim()}
      title={title || trimmed}
      aria-expanded={open}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOpen((current) => !current);
      }}
    >
      {open ? trimmed : preview}
    </button>
  );
}
