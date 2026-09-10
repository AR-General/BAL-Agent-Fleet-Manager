import { useEffect, useState, type ImgHTMLAttributes, type MouseEvent } from "react";
import { apiBlob } from "../../api/client";
import { useImageLightboxOptional } from "./ImageLightbox";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  /** API path after /api/v1, e.g. /instances/oc-white/images/uuid */
  apiPath: string;
  fallbackClassName?: string;
  /** Open full-size preview in lightbox on click */
  enlargeable?: boolean;
  lightboxTitle?: string;
};

const blobCache = new Map<string, string>();

export function AuthenticatedImage({
  apiPath,
  alt = "",
  className,
  fallbackClassName = "auth-img-fallback",
  style,
  enlargeable = false,
  lightboxTitle,
  onClick,
  ...rest
}: Props) {
  const lightbox = useImageLightboxOptional();
  const [src, setSrc] = useState<string | null>(() => blobCache.get(apiPath) ?? null);
  const [failed, setFailed] = useState(false);

  const canEnlarge = enlargeable && !!lightbox;

  function handleClick(e: MouseEvent<HTMLImageElement>) {
    onClick?.(e);
    if (!canEnlarge || failed || !src) return;
    e.preventDefault();
    e.stopPropagation();
    lightbox!.open({ apiPath, title: lightboxTitle || alt, alt });
  }

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;

    const cached = blobCache.get(apiPath);
    if (cached) {
      setSrc(cached);
      setFailed(false);
      return;
    }

    setSrc(null);
    setFailed(false);

    void apiBlob(apiPath)
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        revoked = url;
        blobCache.set(apiPath, url);
        setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (revoked && blobCache.get(apiPath) !== revoked) {
        URL.revokeObjectURL(revoked);
      }
    };
  }, [apiPath]);

  if (failed) {
    return (
      <span
        className={fallbackClassName}
        style={style}
        title="Failed to load image"
        role="img"
        aria-label={alt || "Image unavailable"}
      />
    );
  }

  if (!src) {
    return (
      <span
        className={fallbackClassName}
        style={style}
        title="Loading…"
        role="img"
        aria-label={alt || "Loading image"}
      />
    );
  }

  const imgStyle = canEnlarge ? { ...style, cursor: "zoom-in" } : style;

  return (
    <img
      {...rest}
      src={src}
      alt={alt}
      className={canEnlarge ? `${className ?? ""} auth-img-enlargeable`.trim() : className}
      style={imgStyle}
      onClick={canEnlarge || onClick ? handleClick : undefined}
      title={canEnlarge ? lightboxTitle || alt || "Click to enlarge" : rest.title}
    />
  );
}

/** Call after upload/delete so list cards refetch fresh blobs. */
export function invalidateAuthenticatedImageCache(apiPathPrefix?: string) {
  if (!apiPathPrefix) {
    for (const url of blobCache.values()) URL.revokeObjectURL(url);
    blobCache.clear();
    return;
  }
  for (const [key, url] of blobCache.entries()) {
    if (key.startsWith(apiPathPrefix)) {
      URL.revokeObjectURL(url);
      blobCache.delete(key);
    }
  }
}
