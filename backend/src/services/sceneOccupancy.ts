/** Compact live-scene occupancy for Hermes (no Three.js). */

export type SceneOccupantPose = {
  slug: string;
  x: number;
  z: number;
  facing: number;
  present: boolean;
};

const MAX_OCCUPANTS = 32;

export function normalizeOccupantPoses(raw: unknown): SceneOccupantPose[] {
  if (!Array.isArray(raw)) return [];
  const out: SceneOccupantPose[] = [];
  const seen = new Set<string>();
  for (const row of raw.slice(0, MAX_OCCUPANTS)) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const slug = String(rec.slug || rec.id || "").trim();
    if (!slug || seen.has(slug.toLowerCase())) continue;
    seen.add(slug.toLowerCase());
    const x = Number(rec.x);
    const z = Number(rec.z);
    const facing = Number(rec.facing);
    out.push({
      slug,
      x: Number.isFinite(x) ? x : 0,
      z: Number.isFinite(z) ? z : 0,
      facing: Number.isFinite(facing) ? facing : 0,
      present: rec.present !== false,
    });
  }
  return out;
}

export function occupantPoseKey(occupants: SceneOccupantPose[]): string {
  return occupants
    .map(
      (o) =>
        `${o.slug}:${o.present ? 1 : 0}:${o.x.toFixed(1)}:${o.z.toFixed(1)}:${o.facing.toFixed(1)}`,
    )
    .join("|");
}

/**
 * Keep the live pose snapshot aligned with the current room roster so a join/leave
 * is visible on the next generation even if the 3D client has not posted yet.
 */
export function mergeRosterIntoOccupants(
  roster: string[],
  occupants: SceneOccupantPose[],
): SceneOccupantPose[] {
  const slugs = [...new Set(roster.map((s) => s.trim()).filter(Boolean))];
  if (!slugs.length) return [];
  const wanted = new Set(slugs.map((s) => s.toLowerCase()));
  const byLower = new Map<string, SceneOccupantPose>();
  for (const occ of occupants) {
    const key = occ.slug.trim().toLowerCase();
    if (!key || !wanted.has(key) || byLower.has(key)) continue;
    byLower.set(key, occ);
  }
  return slugs.map((slug) => {
    const existing = byLower.get(slug.toLowerCase());
    if (existing) return { ...existing, slug };
    return { slug, x: 0, z: 0, facing: 0, present: true };
  });
}

/**
 * Motion tags + live XZ list. Walk/approach stay tag-based; TTS uses the native
 * character_speak tool when speak-mode is tool.
 */
export function formatViewportMotionPrompt(opts: {
  selfSlug: string;
  roster: string[];
  occupants: SceneOccupantPose[];
}): string {
  const self = opts.selfSlug.trim().toLowerCase();
  const occupants = mergeRosterIntoOccupants(opts.roster, opts.occupants);
  const lines: string[] = [
    "Viewport: live 3D VRM scene is open for this chat.",
    "Motion is client-side square-bracket tags in your printed reply or inside character_speak text. Walk/approach are tags, not extra Hermes tools.",
    "Walk to a peer: [approach:@slug] [approach:@slug,from=left]. Face: [turnto:@slug]. Gesture at them: [wave:@slug].",
    "Relative move: [walk:forward=2] [walk:right=1] [turn:90] [jump]. Prefer @slug over raw xz.",
    "Prefer tags over explaining gestures. Do not invent scene geometry.",
  ];

  if (occupants.length) {
    lines.push("Live scene occupants (meters, XZ; facing 0 = +Z toward the default camera):");
    for (const o of occupants) {
      const you = o.slug.toLowerCase() === self ? " (you)" : "";
      const known = opts.occupants.some((row) => row.slug.toLowerCase() === o.slug.toLowerCase());
      const body = !known ? "just joined, pose pending" : o.present ? "VRM" : "empty slot";
      lines.push(
        `- @${o.slug}${you} at x=${o.x.toFixed(1)} z=${o.z.toFixed(1)} facing ${o.facing.toFixed(2)} [${body}]`,
      );
    }
    lines.push("Everyone listed here is in the room with you, including anyone who just joined. Do not claim they are absent.");
    return lines.join("\n");
  }

  if (opts.roster.length) {
    lines.push(
      `These agents have avatars reserved in the shared 3D scene: ${opts.roster.map((s) => `@${s}`).join(", ")}.`,
      "Treat listed peers as visible. Use [approach:@slug] to walk to them.",
    );
  }
  return lines.join("\n");
}
