import type { Session } from "../components/chat/types";

/** Agent slugs to show as avatars: 1 for DM, up to 4 for groups. */
export function sessionAvatarSlugs(session: Session): string[] {
  const slugs = (session.participantInstanceSlugs || []).map((s) => s.trim()).filter(Boolean);
  const isDirect = session.sessionType === "direct" || slugs.length <= 1;
  if (isDirect) {
    const one = (session.primarySlug || slugs[0] || "").trim();
    return one ? [one] : [];
  }
  return slugs.slice(0, 4);
}
