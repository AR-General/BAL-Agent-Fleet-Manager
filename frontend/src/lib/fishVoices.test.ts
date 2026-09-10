import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_FISH_VOICE_ID,
  FISH_LIBRARY_VOICES,
  defaultFishVoiceLabel,
  groupFishVoices,
  presenceFishVoiceId,
  resolveFishVoiceId,
  selectVoiceValue,
} from "./fishVoices.ts";

describe("fishVoices", () => {
  it("uses the documented default when an avatar has no voice id", () => {
    assert.equal(resolveFishVoiceId(null), DEFAULT_FISH_VOICE_ID);
    assert.equal(resolveFishVoiceId(""), DEFAULT_FISH_VOICE_ID);
    assert.equal(resolveFishVoiceId("nope"), DEFAULT_FISH_VOICE_ID);
    assert.equal(
      resolveFishVoiceId("9a9cf47702da476aa4629e2506d4a857"),
      "9a9cf47702da476aa4629e2506d4a857",
    );
  });

  it("reads camelCase or snake_case presence fields", () => {
    assert.equal(presenceFishVoiceId({ fishVoiceId: "ca3007f96ae7499ab87d27ea3599956a" }), "ca3007f96ae7499ab87d27ea3599956a");
    assert.equal(presenceFishVoiceId({ fish_voice_id: "9a9cf47702da476aa4629e2506d4a857" }), "9a9cf47702da476aa4629e2506d4a857");
    assert.equal(presenceFishVoiceId(null), "");
  });

  it("treats the default id as the Default dropdown value", () => {
    assert.equal(selectVoiceValue("", DEFAULT_FISH_VOICE_ID), "");
    assert.equal(selectVoiceValue(DEFAULT_FISH_VOICE_ID, DEFAULT_FISH_VOICE_ID), "");
    assert.equal(selectVoiceValue("9a9cf47702da476aa4629e2506d4a857", DEFAULT_FISH_VOICE_ID), "9a9cf47702da476aa4629e2506d4a857");
    assert.equal(defaultFishVoiceLabel(FISH_LIBRARY_VOICES), "Default — E-Girl");
  });

  it("groups workspace voices ahead of the library", () => {
    const grouped = groupFishVoices([
      { id: DEFAULT_FISH_VOICE_ID, title: "Mine", source: "workspace" },
      ...FISH_LIBRARY_VOICES,
    ]);
    assert.equal(grouped.workspace[0]?.title, "Mine");
    assert.equal(
      grouped.library.some((v) => v.id === DEFAULT_FISH_VOICE_ID),
      false,
    );
    assert.ok(grouped.library.some((v) => v.id === "9a9cf47702da476aa4629e2506d4a857"));
  });
});
