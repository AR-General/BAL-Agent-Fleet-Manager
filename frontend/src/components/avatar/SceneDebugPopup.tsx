import { useEffect, useMemo, useState } from "react";
import {
  spawnObject,
  writeObject,
  playObjectEffect,
  stopObjectEffect,
  removeObject,
  listCatalog,
} from "@nexus/objects-kit";
import { spawnRobot } from "@nexus/robots-kit";
import { bindTool } from "@nexus/agent-tools-kit";
import type { SceneGraphHost } from "../../lib/sceneGraphHost";

type Props = {
  open: boolean;
  host: SceneGraphHost | null;
  selectedAgentSlug?: string | null;
  pos: { x: number; y: number };
  onClose: () => void;
  onDragHandlePointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
};

const SHAPES = ["sphere", "box", "cylinder", "cone", "capsule"] as const;

/** Draggable scene object/robot playground — mirrors MotionDebugPopup chrome. */
export function SceneDebugPopup({
  open,
  host,
  selectedAgentSlug,
  pos,
  onClose,
  onDragHandlePointerDown,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shape, setShape] = useState<(typeof SHAPES)[number]>("sphere");
  const [color, setColor] = useState("#ffcc33");
  const [bindToolName, setBindToolName] = useState("web_search");
  const [tick, setTick] = useState(0);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !host) return;
    return host.graph.subscribe(({ op, entity }) => {
      setTick((n) => n + 1);
      setLog((prev) =>
        [`${op.kind} ${entity?.id || op.entityId || ""} rev=${host.graph.getRev()}`, ...prev].slice(
          0,
          12,
        ),
      );
    });
  }, [open, host]);

  useEffect(() => {
    host?.setSelected(selectedId);
  }, [host, selectedId]);

  const entities = useMemo(() => {
    void tick;
    return host?.graph.list().filter((e) => e.kind === "object" || e.kind === "robot") || [];
  }, [host, tick]);

  const catalog = useMemo(() => listCatalog(host?.objects.getCatalog() || []), [host, tick]);

  if (!open) return null;

  const pushLog = (msg: string) => setLog((prev) => [msg, ...prev].slice(0, 12));

  const addShape = () => {
    if (!host) return;
    const pose = selectedAgentSlug ? host.getAgentPose(selectedAgentSlug) : undefined;
    const result = spawnObject(host.graph, {
      shape,
      color,
      label: shape,
      at: "front",
      callerPose: pose,
      ownerSlug: selectedAgentSlug || undefined,
    });
    if (result.ok && result.entity) setSelectedId(result.entity.id);
    pushLog(result.ok ? `spawn ${result.entity?.id}` : `spawn failed: ${result.message}`);
  };

  const addCatalog = (catalogId: string) => {
    if (!host) return;
    const pose = selectedAgentSlug ? host.getAgentPose(selectedAgentSlug) : undefined;
    const result = spawnObject(host.graph, {
      catalogId,
      label: catalogId,
      at: "front",
      callerPose: pose,
      ownerSlug: selectedAgentSlug || undefined,
    });
    if (result.ok && result.entity) setSelectedId(result.entity.id);
    pushLog(result.ok ? `catalog ${catalogId}` : `catalog failed`);
  };

  const addRobot = () => {
    if (!host) return;
    const pose = selectedAgentSlug ? host.getAgentPose(selectedAgentSlug) : undefined;
    const result = spawnRobot(host.graph, {
      label: "machine",
      color: "#88aacc",
      at: "front",
      callerPose: pose,
      ownerSlug: selectedAgentSlug || undefined,
    });
    if (result.ok && result.entity) setSelectedId(result.entity.id);
    pushLog(result.ok ? `robot ${result.entity?.id}` : `robot failed`);
  };

  const runEffect = (effect: string) => {
    if (!host || !selectedId) return;
    playObjectEffect(host.graph, selectedId, effect, { color });
    host.objects.playEffect(selectedId, effect, { color });
    pushLog(`${effect} → ${selectedId}`);
  };

  const nudge = (dx: number, dz: number) => {
    if (!host || !selectedId) return;
    const e = host.graph.get(selectedId);
    if (!e) return;
    host.graph.apply({
      kind: "move",
      entityId: selectedId,
      payload: { pose: { ...e.pose, x: e.pose.x + dx, z: e.pose.z + dz } },
    });
  };

  const recolor = () => {
    if (!host || !selectedId) return;
    writeObject(host.graph, selectedId, { color });
    pushLog(`color ${selectedId}`);
  };

  const removeSelected = () => {
    if (!host || !selectedId) return;
    removeObject(host.graph, selectedId);
    host.setSelected(null);
    setSelectedId(null);
    pushLog(`remove`);
  };

  const bindSelected = () => {
    if (!host || !selectedId) return;
    const r = bindTool(host.graph, { tool: bindToolName.trim() || "web_search", entityId: selectedId });
    pushLog(r.ok ? `bind ${bindToolName}` : `bind failed`);
  };

  const testTool = () => {
    if (!host) return;
    const tool = bindToolName.trim() || "web_search";
    host.handleToolEvent({
      tool,
      status: "start",
      agent: selectedAgentSlug || "agent",
    });
    window.setTimeout(() => {
      host.handleToolEvent({ tool, status: "progress", agent: selectedAgentSlug || "agent" });
    }, 400);
    window.setTimeout(() => {
      host.handleToolEvent({ tool, status: "end", agent: selectedAgentSlug || "agent" });
    }, 1600);
    pushLog(`test tool ${tool}`);
  };

  return (
    <div
      className="motion-debug-popup scene-debug-popup"
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-label="Scene objects debug"
    >
      <div className="motion-debug-head" onPointerDown={onDragHandlePointerDown}>
        <strong>Scene objects</strong>
        <button type="button" className="ghost" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {!host ? (
        <p className="muted">Scene host unavailable — avatars still work.</p>
      ) : (
        <>
          <div className="scene-debug-row">
            <select value={shape} onChange={(e) => setShape(e.target.value as (typeof SHAPES)[number])}>
              {SHAPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Color" />
            <button type="button" onClick={addShape}>
              Add
            </button>
            <button type="button" onClick={addRobot}>
              Robot
            </button>
          </div>
          {catalog.length ? (
            <div className="scene-debug-catalog">
              {catalog.map((c) => (
                <button key={c.id} type="button" className="ghost" onClick={() => addCatalog(c.id)}>
                  {c.label}
                </button>
              ))}
            </div>
          ) : null}
          <ul className="scene-debug-list">
            {entities.length === 0 ? <li className="muted">No objects yet</li> : null}
            {entities.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className={selectedId === e.id ? "active" : ""}
                  onClick={() => setSelectedId(e.id)}
                >
                  [{e.kind}] {e.label}{" "}
                  <span className="muted">
                    ({e.pose.x.toFixed(1)}, {e.pose.z.toFixed(1)})
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="scene-debug-actions">
            <button type="button" disabled={!selectedId} onClick={() => runEffect("glow")}>
              Glow
            </button>
            <button type="button" disabled={!selectedId} onClick={() => runEffect("pulse")}>
              Pulse
            </button>
            <button type="button" disabled={!selectedId} onClick={() => runEffect("spin")}>
              Spin
            </button>
            <button type="button" disabled={!selectedId} onClick={recolor}>
              Recolor
            </button>
            <button type="button" disabled={!selectedId} onClick={() => nudge(-0.3, 0)}>
              ←
            </button>
            <button type="button" disabled={!selectedId} onClick={() => nudge(0.3, 0)}>
              →
            </button>
            <button type="button" disabled={!selectedId} onClick={() => nudge(0, -0.3)}>
              ↑
            </button>
            <button type="button" disabled={!selectedId} onClick={() => nudge(0, 0.3)}>
              ↓
            </button>
            <button type="button" disabled={!selectedId} onClick={removeSelected}>
              Remove
            </button>
            <button
              type="button"
              disabled={!selectedId}
              onClick={() => selectedId && stopObjectEffect(host.graph, selectedId)}
            >
              Stop FX
            </button>
          </div>
          <div className="scene-debug-row">
            <input
              value={bindToolName}
              onChange={(e) => setBindToolName(e.target.value)}
              placeholder="tool name"
              aria-label="Tool name to bind"
            />
            <button type="button" disabled={!selectedId} onClick={bindSelected}>
              Bind
            </button>
            <button type="button" onClick={testTool}>
              Test tool
            </button>
          </div>
          <ol className="scene-debug-log">
            {log.map((line, i) => (
              <li key={`${i}-${line}`}>{line}</li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
