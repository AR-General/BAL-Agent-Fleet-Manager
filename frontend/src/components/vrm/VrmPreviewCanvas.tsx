import { useEffect, useRef } from "react";
import { CompanionHost } from "@nexus/character-kit";

type Props = {
  vrmUrl: string;
  height?: number;
};

/** Small orbit preview of a single VRM. Parent supplies an already-resolved URL (http or blob). */
export function VrmPreviewCanvas({ vrmUrl, height = 360 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<CompanionHost | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const host = new CompanionHost(canvas, {
      orbitControls: true,
      pointerLook: false,
      background: 0x12171c,
    });
    hostRef.current = host;
    return () => {
      host.dispose();
      hostRef.current = null;
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !vrmUrl) return;
    void host.load({ vrmUrl }).catch(() => {
      /* preview errors surface as empty canvas */
    });
  }, [vrmUrl]);

  return (
    <canvas
      ref={canvasRef}
      className="vrm-preview-canvas"
      style={{ width: "100%", height, display: "block", borderRadius: 8 }}
    />
  );
}
