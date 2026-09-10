import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Keep chat chrome above the on-screen keyboard via visualViewport. */
export function useVisualViewportHeight(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      document.documentElement.style.removeProperty("--chat-vv-height");
      return;
    }

    const viewport = window.visualViewport;
    const apply = () => {
      const height = viewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--chat-vv-height", `${Math.round(height)}px`);
    };

    apply();
    viewport?.addEventListener("resize", apply);
    viewport?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    return () => {
      viewport?.removeEventListener("resize", apply);
      viewport?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
      document.documentElement.style.removeProperty("--chat-vv-height");
    };
  }, [enabled]);
}
