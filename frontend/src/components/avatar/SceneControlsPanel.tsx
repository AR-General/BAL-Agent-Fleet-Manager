import type { CompanionHost } from "@nexus/character-kit";
import type { CompanionSceneControlState } from "../../hooks/useCompanionSceneControls";

type Props = {
  host: CompanionHost | null;
  mood: string;
  onMoodChange: (mood: string) => void;
  controls: CompanionSceneControlState;
  /** When set, mouse-look checkbox is controlled by avatar config (for persist). */
  pointerLookOverride?: boolean;
  onPointerLookOverride?: (v: boolean) => void;
};

/** Gaze / walk / motion debug — lives inside the avatar config dialog. */
export function SceneControlsPanel({
  host,
  mood,
  onMoodChange,
  controls,
  pointerLookOverride,
  onPointerLookOverride,
}: Props) {
  const {
    pointerLook,
    setPointerLook,
    bodyFollow,
    setBodyFollow,
    keysOn,
    setKeysOn,
    walkSpeed,
    setWalkSpeed,
    headYaw,
    setHeadYaw,
    eyeYaw,
    setEyeYaw,
    gestures,
    actions,
    clearActions,
    loopGesture,
    setLoopGesture,
    moods,
    formatActionDelta,
  } = controls;

  const look = pointerLookOverride ?? pointerLook;
  function setLook(v: boolean) {
    setPointerLook(v);
    onPointerLookOverride?.(v);
  }

  return (
    <div className="avatar-scene-controls">
      <strong className="muted">Scene controls</strong>
      <div className="avatar-config-row wrap">
        <label className="chat-avatar-toggle">
          <input type="checkbox" checked={look} onChange={(e) => setLook(e.target.checked)} />
          Mouse look
        </label>
        <label className="chat-avatar-toggle">
          <input type="checkbox" checked={keysOn} onChange={(e) => setKeysOn(e.target.checked)} />
          WASD walk
        </label>
        <label className="chat-avatar-toggle">
          <input
            type="checkbox"
            checked={bodyFollow}
            onChange={(e) => setBodyFollow(e.target.checked)}
          />
          Body follow camera
        </label>
      </div>

      <label>
        Head yaw max °
        <input
          type="number"
          min={5}
          max={90}
          value={headYaw}
          onChange={(e) => setHeadYaw(Number(e.target.value))}
        />
      </label>
      <label>
        Eye yaw max °
        <input
          type="number"
          min={0}
          max={90}
          value={eyeYaw}
          onChange={(e) => setEyeYaw(Number(e.target.value))}
        />
      </label>
      <label>
        Walk speed
        <input
          type="range"
          min={0.4}
          max={3}
          step={0.1}
          value={walkSpeed}
          onChange={(e) => setWalkSpeed(Number(e.target.value))}
        />
      </label>

      <div className="avatar-config-head">
        <strong className="muted">Gestures</strong>
        <button type="button" className="secondary" onClick={clearActions}>
          Clear feed
        </button>
      </div>
      <div className="companion-mood-chips">
        {moods.map((m) => (
          <button
            key={m.id}
            type="button"
            className={mood === m.id ? "" : "secondary"}
            onClick={() => {
              host?.setMood(m.id);
              onMoodChange(m.id);
            }}
          >
            {m.id}
          </button>
        ))}
      </div>
      <label className="chat-avatar-toggle">
        <input
          type="checkbox"
          checked={loopGesture}
          onChange={(e) => setLoopGesture(e.target.checked)}
        />
        Loop gesture
      </label>
      <div className="companion-mood-chips">
        {gestures.slice(0, 24).map((g) => (
          <button
            key={g}
            type="button"
            className="secondary"
            onClick={() => host?.playGesture(g, loopGesture)}
          >
            {g}
          </button>
        ))}
      </div>
    </div>
  );
}
