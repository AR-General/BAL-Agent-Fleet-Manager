import { InstanceProfileAvatar } from "../instances/InstanceProfileAvatar";
import { sessionAvatarSlugs } from "../../lib/sessionAvatarSlugs";
import type { Session } from "./types";

export type ProfilePreview = { image_id: string; image_type: string } | null;
export type ProfilePreviews = Record<string, ProfilePreview>;

type Props = {
  session: Session;
  previews: ProfilePreviews;
  /** Outer box size in px (single avatar or 2×2 grid). */
  size?: number;
};

/**
 * DM: one agent icon. Group/channel: up to four icons in a 2×2 square.
 */
export function SessionAvatarBadge({ session, previews, size = 36 }: Props) {
  const slugs = sessionAvatarSlugs(session);
  const title = slugs.join(", ") || "No agents";

  if (!slugs.length) {
    return (
      <span
        className="chat-session-avatars chat-session-avatars-empty"
        style={{ width: size, height: size }}
        title={title}
        aria-hidden
      />
    );
  }

  if (slugs.length === 1) {
    const slug = slugs[0]!;
    const preview = previews[slug];
    return (
      <span className="chat-session-avatars chat-session-avatars-single" style={{ width: size, height: size }} title={title}>
        {preview?.image_id ? (
          <InstanceProfileAvatar slug={slug} imageId={preview.image_id} size={size} title={slug} enlargeable={false} />
        ) : (
          <span className="chat-session-avatar-letter" style={{ width: size, height: size }} aria-hidden>
            {slug.slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>
    );
  }

  const cell = Math.max(8, Math.floor((size - 1) / 2));
  return (
    <span
      className="chat-session-avatars chat-session-avatars-grid"
      style={{ width: size, height: size }}
      title={title}
      aria-label={title}
    >
      {slugs.map((slug) => {
        const preview = previews[slug];
        return preview?.image_id ? (
          <InstanceProfileAvatar
            key={slug}
            slug={slug}
            imageId={preview.image_id}
            size={cell}
            title={slug}
            enlargeable={false}
          />
        ) : (
          <span key={slug} className="chat-session-avatar-letter" style={{ width: cell, height: cell }} aria-hidden>
            {slug.slice(0, 1).toUpperCase()}
          </span>
        );
      })}
    </span>
  );
}
