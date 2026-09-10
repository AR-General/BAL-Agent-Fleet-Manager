import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/client";
import { filterLlmCatalog, type LlmModelOption } from "../../lib/llmModels";
import { ModelSelect } from "./ModelSelect";

type AgentModel = LlmModelOption;

type Props = {
  slug: string;
  x: number;
  y: number;
  paused: boolean;
  currentModel?: string | null;
  canRemove: boolean;
  onClose: () => void;
  onRemove: () => void;
  onConfigureAvatar: () => void;
  onTogglePause: () => void;
  onSelectModel: (modelId: string) => void;
};

function clampMenu(x: number, y: number, width: number, height: number): { left: number; top: number } {
  const pad = 8;
  const left = Math.min(Math.max(pad, x), Math.max(pad, window.innerWidth - width - pad));
  const top = Math.min(Math.max(pad, y), Math.max(pad, window.innerHeight - height - pad));
  return { left, top };
}

export function ParticipantContextMenu({
  slug,
  x,
  y,
  paused,
  currentModel,
  canRemove,
  onClose,
  onRemove,
  onConfigureAvatar,
  onTogglePause,
  onSelectModel,
}: Props) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [models, setModels] = useState<AgentModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState("");
  const [runtime, setRuntime] = useState<string>("");
  const [modelsOpen, setModelsOpen] = useState(false);
  const [size, setSize] = useState({ width: 240, height: 220 });

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setSize({ width: box.width, height: box.height });
  }, [modelsOpen, models.length, modelsLoading]);

  useEffect(() => {
    let cancelled = false;
    setModelsLoading(true);
    setModelsError("");
    void api<{ models?: AgentModel[]; default_model?: string; runtime?: string }>(
      `/instances/${encodeURIComponent(slug)}/models`,
    )
      .then((payload) => {
        if (cancelled) return;
        setRuntime(payload.runtime || "");
        const next = filterLlmCatalog(payload.models, slug);
        setModels(next);
      })
      .catch((error) => {
        if (cancelled) return;
        setModelsError(error instanceof Error ? error.message : "Failed to load models");
        setModels(currentModel ? [{ id: currentModel }] : []);
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, currentModel]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function onPointer(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [onClose]);

  const pos = useMemo(
    () => clampMenu(x, y, size.width, size.height),
    [x, y, size.height, size.width],
  );
  const runtimeLabel =
    runtime === "hermes" ? "Gateway" : runtime === "openclaw" ? "OpenClaw" : runtime || "OpenAI-like";

  return createPortal(
    <div
      ref={menuRef}
      className="chat-participant-menu"
      role="menu"
      aria-label={`Actions for @${slug}`}
      data-ack-ignore=""
      style={{ left: pos.left, top: pos.top }}
    >
      <header className="chat-participant-menu-head">@{slug}</header>
      <button type="button" role="menuitem" onClick={onConfigureAvatar}>
        Configure avatar
      </button>
      <button type="button" role="menuitem" onClick={onTogglePause}>
        {paused ? "Resume" : "Pause (ignore everything)"}
      </button>
      <button
        type="button"
        role="menuitem"
        aria-expanded={modelsOpen}
        onClick={() => setModelsOpen((open) => !open)}
      >
        Select model
      </button>
      {modelsOpen ? (
        <div className="chat-participant-menu-models">
          <p className="muted">
            {modelsLoading ? "Loading models…" : `${runtimeLabel} models`}
          </p>
          {modelsError ? <p className="badge bad">{modelsError}</p> : null}
          <ModelSelect
            models={models}
            value={currentModel || models[0]?.id || ""}
            disabled={false}
            loading={modelsLoading}
            onChange={(id) => {
              if (id) onSelectModel(id);
            }}
          />
        </div>
      ) : null}
      <button type="button" role="menuitem" className="danger" disabled={!canRemove} onClick={onRemove}>
        Remove
      </button>
    </div>,
    document.body,
  );
}
