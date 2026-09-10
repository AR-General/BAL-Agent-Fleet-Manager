import {
  compactClothesTransform,
  defaultClothesTransform,
  normalizeClothesTransform,
  type ClothesPieceTransform,
} from "@nexus/character-kit";

type Props = {
  value?: Partial<ClothesPieceTransform> | null;
  onChange: (next: Partial<ClothesPieceTransform> | undefined) => void;
};

export function ClothesPieceConfig({ value, onChange }: Props) {
  const t = normalizeClothesTransform(value);

  function commit(patch: Partial<ClothesPieceTransform>) {
    onChange(compactClothesTransform(normalizeClothesTransform({ ...t, ...patch })));
  }

  return (
    <div className="clothes-piece-cfg">
      <div className="clothes-piece-row">
        <span className="muted">Mirror</span>
        {(["mirrorX", "mirrorY", "mirrorZ"] as const).map((key, i) => (
          <label key={key} className="chat-avatar-toggle">
            <input
              type="checkbox"
              checked={t[key]}
              onChange={(e) => commit({ [key]: e.target.checked })}
            />
            {["X", "Y", "Z"][i]}
          </label>
        ))}
      </div>
      <div className="clothes-piece-row nums">
        <span className="muted">Offset</span>
        {(["offsetX", "offsetY", "offsetZ"] as const).map((key, i) => (
          <label key={key}>
            {["X", "Y", "Z"][i]}
            <input
              type="number"
              step={0.01}
              min={-2}
              max={2}
              value={t[key]}
              onChange={(e) => commit({ [key]: Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
      <div className="clothes-piece-row nums">
        <span className="muted">Scale</span>
        <label>
          <input
            type="number"
            step={0.05}
            min={0.05}
            max={4}
            value={t.scale}
            onChange={(e) => commit({ scale: Number(e.target.value) })}
          />
        </label>
        <button type="button" className="secondary" onClick={() => onChange(undefined)}>
          Reset
        </button>
      </div>
      <div className="clothes-piece-row nums">
        <span className="muted">Rotate°</span>
        {(["rotateX", "rotateY", "rotateZ"] as const).map((key, i) => (
          <label key={key}>
            {["X", "Y", "Z"][i]}
            <input
              type="number"
              step={1}
              min={-180}
              max={180}
              value={t[key]}
              onChange={(e) => commit({ [key]: Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        className="secondary"
        onClick={() => onChange(compactClothesTransform(defaultClothesTransform()))}
      >
        Identity
      </button>
    </div>
  );
}
