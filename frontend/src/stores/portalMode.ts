import { create } from "zustand";

/** Demo = public-facing portal preview; internal = operator view with internal assets. */
export type PortalMode = "internal" | "demo";

type PortalState = {
  mode: PortalMode;
  setMode: (m: PortalMode) => void;
  /** Image type used for list previews and primary avatar */
  previewImageType: () => "public" | "internal";
};

export const usePortalMode = create<PortalState>((set, get) => ({
  mode: (localStorage.getItem("oc_portal_mode") as PortalMode) || "internal",
  setMode: (mode) => {
    localStorage.setItem("oc_portal_mode", mode);
    set({ mode });
  },
  previewImageType: () => (get().mode === "demo" ? "public" : "internal"),
}));
