import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { apiBlob } from "../../api/client";

export type ImageLightboxState = {
  apiPath: string;
  title?: string;
  alt?: string;
};

type LightboxContextValue = {
  open: (state: ImageLightboxState) => void;
  close: () => void;
};

const ImageLightboxContext = createContext<LightboxContextValue | null>(null);

function LightboxImage({ apiPath, alt }: { apiPath: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    void apiBlob(apiPath)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [apiPath]);

  if (!src) {
    return <p className="muted">Loading preview…</p>;
  }

  return <img src={src} alt={alt} className="img-lightbox-img" />;
}

export function ImageLightboxProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ImageLightboxState | null>(null);

  const close = useCallback(() => setState(null), []);
  const open = useCallback((next: ImageLightboxState) => setState(next), []);

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, close]);

  return (
    <ImageLightboxContext.Provider value={{ open, close }}>
      {children}
      {state && (
        <div
          className="img-lightbox-overlay"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label={state.title || "Image preview"}
        >
          <button type="button" className="img-lightbox-close secondary" onClick={close} aria-label="Close">
            ×
          </button>
          {state.title && <p className="img-lightbox-title">{state.title}</p>}
          <div className="img-lightbox-frame" onClick={(e) => e.stopPropagation()}>
            <LightboxImage apiPath={state.apiPath} alt={state.alt || state.title || "Preview"} />
          </div>
        </div>
      )}
    </ImageLightboxContext.Provider>
  );
}

export function useImageLightbox(): LightboxContextValue {
  const ctx = useContext(ImageLightboxContext);
  if (!ctx) {
    throw new Error("useImageLightbox must be used within ImageLightboxProvider");
  }
  return ctx;
}

/** Safe for thumbnails — returns null when provider is not mounted. */
export function useImageLightboxOptional(): LightboxContextValue | null {
  return useContext(ImageLightboxContext);
}
