import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { VrmModel } from "../lib/vrmLibrary";

type State = {
  models: VrmModel[];
  libraryDir: string;
  loading: boolean;
  error: string;
};

const INITIAL: State = { models: [], libraryDir: "", loading: true, error: "" };

export function useVrmModels(includeHidden = false): State & { reload: () => void } {
  const [state, setState] = useState<State>(INITIAL);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: "" }));
    const q = includeHidden ? "?include_hidden=1" : "";
    void api<{ models: VrmModel[]; library_dir?: string }>(`/vrm-models${q}`)
      .then((r) => {
        if (cancelled) return;
        setState({
          models: r.models || [],
          libraryDir: r.library_dir || "",
          loading: false,
          error: "",
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          ...INITIAL,
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load VRM library",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [includeHidden, tick]);

  return { ...state, reload: () => setTick((n) => n + 1) };
}
