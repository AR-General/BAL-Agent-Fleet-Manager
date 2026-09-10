import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { avatarPresencePatchFromBody, avatarPresenceToClient } from "./avatarPresenceDto.js";

describe("avatarPresenceDto", () => {
  it("exposes both snake_case and camelCase for the portal", () => {
    const dto = avatarPresenceToClient("gamma", {
      vrmUrl: "/dev-vrm-assets/vrm/tori.vrm",
      gestureManifestUrl: null,
      defaultMood: "playful",
      clothes: { clothesId: "default" },
      fishVoiceId: "voice-1",
      pointerLook: true,
      defaultModelId: null,
      settings: { catalog_id: "tori" },
    });
    assert.ok(dto);
    assert.equal(dto.vrm_url, "/dev-vrm-assets/vrm/tori.vrm");
    assert.equal(dto.vrmUrl, "/dev-vrm-assets/vrm/tori.vrm");
    assert.equal(dto.default_mood, "playful");
    assert.equal(dto.settings.catalog_id, "tori");
  });

  it("omits unspecified fields so an update cannot wipe the stored VRM", () => {
    const patch = avatarPresencePatchFromBody({ fish_voice_id: "x" });
    assert.equal("vrmUrl" in patch, false);
    assert.equal(patch.fishVoiceId, "x");
  });
});
