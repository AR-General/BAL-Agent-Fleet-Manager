import { create } from "zustand";

export type ViewMode = "operator" | "tenant";

type ViewState = {
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
};

export const useViewMode = create<ViewState>((set) => ({
  mode: (localStorage.getItem("oc_view_mode") as ViewMode) || "operator",
  setMode: (mode) => {
    localStorage.setItem("oc_view_mode", mode);
    set({ mode });
  },
}));
