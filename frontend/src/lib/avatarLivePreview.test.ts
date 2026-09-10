import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergeAvatarLivePreview,
  nextLivePreviewUrl,
  type LivePreviewAvatar,
  type LivePreviewPatch,
} from "./avatarLivePreview.ts";

function avatar(over: Partial<LivePreviewAvatar> = {}): LivePreviewAvatar {
  return {
    slug: "gamma",
    vrmUrl: "/dev-vrm-assets/vrm/sample.vrm",
    mood: "neutral",
    pointerLook: true,
    clothes: { clothesId: "default" },
    settings: { live_view: true },
    ...over,
  };
}

function preview(over: Partial<LivePreviewPatch> = {}): LivePreviewPatch {
  return {
    slug: "gamma",
    vrmUrl: "/dev-vrm-assets/vrm/tori.vrm",
    mood: "happy",
    pointerLook: false,
    clothes: { clothesId: "none" },
    ...over,
  };
}

describe("avatarLivePreview", () => {
  it("prefers a local object URL over the catalog vrmUrl", () => {
    assert.equal(
      nextLivePreviewUrl(preview({ previewObjectUrl: "blob:http://localhost/1" })),
      "blob:http://localhost/1",
    );
    assert.equal(nextLivePreviewUrl(preview()), "/dev-vrm-assets/vrm/tori.vrm");
  });

  it("updates vrmUrl when the catalog selection changes (shared/split path)", () => {
    const next = mergeAvatarLivePreview(avatar(), preview());
    assert.equal(next.vrmUrl, "/dev-vrm-assets/vrm/tori.vrm");
    assert.equal(next.mood, "happy");
    assert.equal(next.pointerLook, false);
    assert.equal(next.clothes.clothesId, "none");
  });

  it("keeps the current vrmUrl when the preview URL is empty", () => {
    const next = mergeAvatarLivePreview(avatar(), preview({ vrmUrl: "" }));
    assert.equal(next.vrmUrl, "/dev-vrm-assets/vrm/sample.vrm");
  });

  it("replaces a blob/idb preview URL with a catalog selection", () => {
    const next = mergeAvatarLivePreview(
      avatar({ vrmUrl: "blob:http://localhost/old" }),
      preview({ vrmUrl: "/dev-vrm-assets/vrm/apollo.vrm" }),
    );
    assert.equal(next.vrmUrl, "/dev-vrm-assets/vrm/apollo.vrm");
  });

  it("merges settings without dropping unrelated keys", () => {
    const next = mergeAvatarLivePreview(
      avatar({ settings: { live_view: true, catalog_id: "sample" } }),
      preview({ settings: { motion_debug: true } }),
    );
    assert.equal(next.settings.live_view, true);
    assert.equal(next.settings.catalog_id, "sample");
    assert.equal(next.settings.motion_debug, true);
  });
});
