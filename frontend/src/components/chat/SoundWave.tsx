import { useEffect, useRef, useState } from "react";

/** Compact animated bars for mic / TTS energy (dev-vrm SoundWave port). */
export function SoundWave({
  energy,
  active = false,
  bars = 7,
}: {
  energy: number;
  active?: boolean;
  bars?: number;
}) {
  const [heights, setHeights] = useState(() => waveBarHeights(0, bars, 0));
  const rafRef = useRef(0);
  const energyRef = useRef(energy);
  energyRef.current = energy;

  const energized = energy > 0.03;
  useEffect(() => {
    const on = active || energized;
    cancelAnimationFrame(rafRef.current);
    if (!on) {
      setHeights(waveBarHeights(0, bars, 0));
      return;
    }
    const tick = (now: number) => {
      setHeights(waveBarHeights(energyRef.current, bars, now / 140));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, bars, energized]);

  return (
    <div className={`scene-voice-wave ${active ? "active" : ""}`} aria-hidden="true">
      {heights.map((h, i) => (
        <span key={i} style={{ transform: `scaleY(${h.toFixed(3)})` }} />
      ))}
    </div>
  );
}

function waveBarHeights(energy: number, count: number, phase = 0): number[] {
  const n = Math.max(1, Math.floor(count));
  const e = Math.min(1, Math.max(0, energy));
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const center = (n - 1) / 2;
    const dist = Math.abs(i - center) / Math.max(1, center);
    const wobble = 0.55 + 0.45 * Math.sin(phase + i * 0.85);
    const h = 0.16 + e * (0.22 + 0.62 * wobble) * (1 - dist * 0.35);
    out[i] = Math.min(1, Math.max(0.16, h));
  }
  return out;
}
