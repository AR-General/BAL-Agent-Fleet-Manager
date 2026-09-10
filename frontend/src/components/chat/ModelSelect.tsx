import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/client";
import {
  enrichLlmOptions,
  formatIntelScore,
  formatUsdPerM,
  intelTone,
  priceTone,
  type EnrichedLlmOption,
  type LlmMetaRow,
} from "../../lib/llmModelMeta";
import { llmOptionLabel, type LlmModelOption } from "../../lib/llmModels";

type Props = {
  models: LlmModelOption[];
  value: string;
  disabled?: boolean;
  loading?: boolean;
  emptyLabel?: string;
  className?: string;
  onChange: (modelId: string) => void;
};

let metaCache: { at: number; rows: LlmMetaRow[]; attribution?: { intelligence: string } } | null =
  null;
const META_TTL_MS = 30 * 60 * 1000;

async function loadMeta(): Promise<{ rows: LlmMetaRow[]; attribution?: { intelligence: string } }> {
  if (metaCache && Date.now() - metaCache.at < META_TTL_MS) {
    return { rows: metaCache.rows, attribution: metaCache.attribution };
  }
  const payload = await api<{
    models?: LlmMetaRow[];
    attribution?: { intelligence?: string; pricing?: string };
  }>("/llm-meta");
  const rows = payload.models || [];
  metaCache = {
    at: Date.now(),
    rows,
    attribution: { intelligence: payload.attribution?.intelligence || "https://artificialanalysis.ai/" },
  };
  return { rows, attribution: metaCache.attribution };
}

export function ModelSelect({
  models,
  value,
  disabled,
  loading,
  emptyLabel = "No LLM catalog",
  className,
  onChange,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [metaRows, setMetaRows] = useState<LlmMetaRow[]>(metaCache?.rows || []);
  const [attribution, setAttribution] = useState(metaCache?.attribution?.intelligence || "");
  const [query, setQuery] = useState("");
  const [menuPos, setMenuPos] = useState({ left: 0, top: 0, width: 420 });

  useEffect(() => {
    let cancelled = false;
    void loadMeta()
      .then((m) => {
        if (cancelled) return;
        setMetaRows(m.rows);
        if (m.attribution?.intelligence) setAttribution(m.attribution.intelligence);
      })
      .catch((err) => {
        console.warn("Failed to load LLM meta", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const enriched = useMemo(
    () => enrichLlmOptions(models, metaRows),
    [models, metaRows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return enriched;
    return enriched.filter((m) => {
      const hay = `${m.id} ${m.label || ""} ${m.owned_by || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [enriched, query]);

  const selected = enriched.find((m) => m.id === value) || null;

  const placeMenu = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const width = Math.min(520, Math.max(360, box.width));
    let left = box.right - width;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = box.bottom + 4;
    const maxH = 360;
    if (top + maxH > window.innerHeight - 8) {
      top = Math.max(8, box.top - maxH - 4);
    }
    setMenuPos({ left, top, width });
  }, []);

  useEffect(() => {
    if (!open) return;
    placeMenu();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onPointer(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        const menu = document.getElementById("oc-model-select-menu");
        if (menu?.contains(e.target as Node)) return;
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("resize", placeMenu);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("resize", placeMenu);
    };
  }, [open, placeMenu]);

  function select(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  const triggerLabel = loading
    ? "Loading…"
    : !models.length
      ? emptyLabel
      : selected
        ? llmOptionLabel(selected)
        : value || "Select model";

  return (
    <div className={`chat-model-picker ${className || ""}`} ref={rootRef}>
      <button
        type="button"
        className="chat-model-picker-trigger"
        disabled={disabled || loading || !models.length}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (disabled || loading || !models.length) return;
          setOpen((v) => !v);
        }}
      >
        <span className="chat-model-picker-trigger-label">{triggerLabel}</span>
        {selected ? (
          <span className="chat-model-picker-trigger-meta" aria-hidden="true">
            <span className={`chat-model-price in ${priceTone(selected.input_per_m)}`}>
              {formatUsdPerM(selected.input_per_m)}
            </span>
            <span className={`chat-model-price out ${priceTone(selected.output_per_m)}`}>
              {formatUsdPerM(selected.output_per_m)}
            </span>
            <span className={`chat-model-intel ${intelTone(selected.intelligence)}`}>
              {formatIntelScore(selected.intelligence)}
            </span>
          </span>
        ) : null}
        <span className="chat-model-picker-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open
        ? createPortal(
            <div
              id="oc-model-select-menu"
              className="chat-model-picker-menu"
              role="listbox"
              style={{ left: menuPos.left, top: menuPos.top, width: menuPos.width }}
            >
              <div className="chat-model-picker-toolbar">
                <input
                  autoFocus
                  type="search"
                  placeholder="Filter models…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="chat-model-picker-head" aria-hidden="true">
                <span>Model</span>
                <span title="USD per 1M input tokens">In $/M</span>
                <span title="USD per 1M output tokens">Out $/M</span>
                <span title="Artificial Analysis Intelligence Index">IQ</span>
              </div>
              <div className="chat-model-picker-list">
                {filtered.map((m) => (
                  <ModelRow
                    key={m.id}
                    model={m}
                    active={m.id === value}
                    onSelect={() => select(m.id)}
                  />
                ))}
                {!filtered.length ? <p className="muted chat-model-picker-empty">No matches</p> : null}
              </div>
              <footer className="chat-model-picker-foot muted">
                IQ:{" "}
                <a href={attribution || "https://artificialanalysis.ai/"} target="_blank" rel="noreferrer">
                  Artificial Analysis
                </a>
                {" · "}
                prices: OpenRouter $/1M tokens
              </footer>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function ModelRow({
  model,
  active,
  onSelect,
}: {
  model: EnrichedLlmOption;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      className={`chat-model-picker-row ${active ? "active" : ""}`}
      onClick={onSelect}
    >
      <span className="chat-model-picker-name">
        <strong>{llmOptionLabel(model)}</strong>
      </span>
      <span className={`chat-model-price in ${priceTone(model.input_per_m)}`}>
        {formatUsdPerM(model.input_per_m)}
      </span>
      <span className={`chat-model-price out ${priceTone(model.output_per_m)}`}>
        {formatUsdPerM(model.output_per_m)}
      </span>
      <span className={`chat-model-intel ${intelTone(model.intelligence)}`}>
        {formatIntelScore(model.intelligence)}
      </span>
    </button>
  );
}
