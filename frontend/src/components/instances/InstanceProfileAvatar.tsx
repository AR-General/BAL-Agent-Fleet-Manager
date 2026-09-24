import { AuthenticatedImage } from "../common/AuthenticatedImage";

type Props = {
  slug: string;
  imageId: string | null | undefined;
  size?: number;
  title?: string;
  /** Open lightbox on click (default true on Instances; false in chat lists). */
  enlargeable?: boolean;
};

export function InstanceProfileAvatar({ slug, imageId, size = 40, title, enlargeable = true }: Props) {
  if (!imageId) {
    return (
      <span
        className="inst-avatar inst-avatar-empty"
        style={{ width: size, height: size }}
        title={title || "No profile image"}
        aria-hidden
      />
    );
  }

  const apiPath = `/instances/${slug}/images/${imageId}`;

  return (
    <AuthenticatedImage
      apiPath={apiPath}
      alt=""
      title={title}
      lightboxTitle={title}
      enlargeable={enlargeable}
      className="inst-avatar"
      fallbackClassName="inst-avatar inst-avatar-empty"
      width={size}
      height={size}
      loading="lazy"
    />
  );
}
