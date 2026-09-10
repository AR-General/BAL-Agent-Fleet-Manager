/**
 * Shared VRM / clothes catalog (mirrors dev-vrm playground).
 * Assets served via Vite `/dev-vrm-assets` → playground public.
 */

export type VrmCatalogEntry = { id: string; label: string; url: string };

const ASSET = "/dev-vrm-assets/vrm";

export const VRM_CATALOG: VrmCatalogEntry[] = [
  { id: "sample", label: "Sample (pixiv)", url: `${ASSET}/sample.vrm` },
  { id: "optional-face", label: "Optional Face", url: `${ASSET}/optional-face.vrm` },
  { id: "blue-or-green", label: "Blue or Green", url: `${ASSET}/blue-or-green.vrm` },
  { id: "cat-ear", label: "Cat Ear", url: `${ASSET}/cat-ear.vrm` },
  { id: "divitiae-animalia", label: "Divitiae Animalia", url: `${ASSET}/divitiae-animalia.vrm` },
  { id: "hoodie", label: "Hoodie", url: `${ASSET}/hoodie.vrm` },
  { id: "animal-path", label: "Animal Path", url: `${ASSET}/animal-path.vrm` },
  { id: "tori", label: "Tori", url: `${ASSET}/tori.vrm` },
  { id: "curt", label: "Curt", url: `${ASSET}/curt.vrm` },
  { id: "apollo", label: "Apollo", url: `${ASSET}/apollo.vrm` },
  { id: "bob", label: "Bob", url: `${ASSET}/bob.vrm` },
];

const CLOTHES_OVERLAY_IDS = new Set([
  "sample",
  "optional-face",
  "blue-or-green",
  "cat-ear",
  "divitiae-animalia",
  "hoodie",
]);

export const CLOTHES_NONE_ID = "none";
export const CLOTHES_DEFAULT_ID = "default";

export const CLOTHES_OVERLAY_CATALOG: VrmCatalogEntry[] = VRM_CATALOG.filter((v) =>
  CLOTHES_OVERLAY_IDS.has(v.id),
);

export function catalogEntryByUrl(url: string | null | undefined): VrmCatalogEntry | undefined {
  if (!url) return undefined;
  return VRM_CATALOG.find((e) => e.url === url || url.endsWith(`/vrm/${e.id}.vrm`));
}

export function catalogEntryById(id: string): VrmCatalogEntry | undefined {
  return VRM_CATALOG.find((e) => e.id === id);
}
