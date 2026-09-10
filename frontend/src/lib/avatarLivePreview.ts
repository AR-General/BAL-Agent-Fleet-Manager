/**
 * Merge avatar-config live preview into viewport avatar state.
 * Shared/split rooms have no solo CompanionHost, so URL changes must be
 * detected against the avatar's current vrmUrl — not host.getLoadedUrl().
 */

export type LivePreviewClothes = {
  clothesId?: string;
  clothesIds?: string[];
  clothesOverlayId?: string;
  clothesOverlayItems?: unknown[];
};

export type LivePreviewAvatar = {
  slug: string;
  vrmUrl: string;
  mood: string;
  pointerLook: boolean;
  clothes: LivePreviewClothes;
  settings: Record<string, unknown>;
};

export type LivePreviewPatch = {
  slug: string;
  vrmUrl: string;
  mood: string;
  pointerLook: boolean;
  clothes: LivePreviewClothes;
  previewObjectUrl?: string | null;
  motionDebug?: boolean;
  settings?: Record<string, unknown>;
};

export function nextLivePreviewUrl(preview: LivePreviewPatch): string {
  return preview.previewObjectUrl || preview.vrmUrl || "";
}

export function mergeAvatarLivePreview<T extends LivePreviewAvatar>(
  avatar: T,
  preview: LivePreviewPatch,
): T {
  const nextUrl = nextLivePreviewUrl(preview);
  const urlChanged = Boolean(nextUrl && nextUrl !== avatar.vrmUrl);
  return {
    ...avatar,
    vrmUrl: urlChanged ? nextUrl : avatar.vrmUrl,
    mood: preview.mood,
    pointerLook: preview.pointerLook,
    clothes: preview.clothes,
    settings: preview.settings
      ? { ...avatar.settings, ...preview.settings }
      : typeof preview.motionDebug === "boolean"
        ? { ...avatar.settings, motion_debug: preview.motionDebug }
        : avatar.settings,
  };
}
