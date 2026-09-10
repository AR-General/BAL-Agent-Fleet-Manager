import type { ProfileImageGroupSettings } from "../routes/instance-images.js";

export type ProfileImageRow = {
  id: string;
  imageType: string;
  sortOrder: number | null;
  isPrimary: boolean | null;
};

export function pickProfileImageForGroup(
  images: ProfileImageRow[],
  imageType: "public" | "internal",
  groupSettings: ProfileImageGroupSettings,
): ProfileImageRow | undefined {
  const typeImages = images
    .filter((i) => i.imageType === imageType)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id));

  if (typeImages.length === 0) return undefined;

  if (!groupSettings.auto_rotate) {
    const primary = typeImages.find((i) => i.isPrimary);
    if (primary) return primary;
  }

  return typeImages[0];
}
