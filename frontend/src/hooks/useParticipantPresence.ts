import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import type { DbInstance } from "../types";
import { presenceFromInstance, type AgentPresence } from "../lib/participantPresence";

const POLL_MS = 20_000;

function slugKey(slugs: string[]): string {
  return slugs.join("\0");
}

export function useParticipantPresence(
  slugs: string[],
  instances: DbInstance[],
): Record<string, AgentPresence> {
  const [live, setLive] = useState<Record<string, AgentPresence>>({});
  const key = slugKey(slugs);
  const slugsRef = useRef(slugs);
  slugsRef.current = slugs;

  const seeded = useMemo(() => {
    const bySlug = new Map(instances.map((i) => [i.slug, i]));
    const out: Record<string, AgentPresence> = {};
    for (const slug of slugs) {
      const inst = bySlug.get(slug);
      out[slug] = inst
        ? presenceFromInstance(inst)
        : {
            slug,
            online: false,
            status: "unknown",
            latency_ms: null,
            last_seen: null,
          };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, instances]);

  useEffect(() => {
    if (!slugs.length) {
      setLive({});
      return;
    }

    let cancelled = false;

    async function refresh() {
      const current = slugsRef.current;
      if (!current.length) return;
      try {
        const payload = await api<{ participants?: AgentPresence[] }>("/health/presence", {
          method: "POST",
          body: JSON.stringify({ slugs: current }),
        });
        if (cancelled) return;
        const next: Record<string, AgentPresence> = {};
        for (const row of payload.participants || []) {
          next[row.slug] = row;
        }
        setLive(next);
      } catch (err) {
        console.warn("Failed to refresh participant presence", err);
      }
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [key, slugs.length]);

  return useMemo(() => {
    const out: Record<string, AgentPresence> = {};
    for (const slug of slugs) {
      out[slug] = live[slug] || seeded[slug];
    }
    return out;
  }, [live, seeded, slugs]);
}
