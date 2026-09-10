import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveEffectiveTtsSpeakMode,
  presenceTtsSpeakMode,
  workspaceTtsSpeakMode,
} from "./ttsSpeakMode.js";

describe("ttsSpeakMode", () => {
  it("defaults workspace mode to tool", () => {
    assert.equal(workspaceTtsSpeakMode(null), "tool");
    assert.equal(workspaceTtsSpeakMode({}), "tool");
    assert.equal(workspaceTtsSpeakMode({ tts_speak_mode: "auto" }), "auto");
  });

  it("treats inherit / unset presence as fall-through", () => {
    assert.equal(presenceTtsSpeakMode(null), null);
    assert.equal(presenceTtsSpeakMode({ tts_speak_mode: "inherit" }), null);
    assert.equal(presenceTtsSpeakMode({ tts_speak_mode: "tool" }), "tool");
  });

  it("resolves presence override over workspace default", () => {
    assert.equal(
      resolveEffectiveTtsSpeakMode({
        presenceSettings: { tts_speak_mode: "tool" },
        workspaceSettings: { tts_speak_mode: "auto" },
      }),
      "tool",
    );
    assert.equal(
      resolveEffectiveTtsSpeakMode({
        presenceSettings: { tts_speak_mode: "inherit" },
        workspaceSettings: { tts_speak_mode: "tool" },
      }),
      "tool",
    );
    assert.equal(
      resolveEffectiveTtsSpeakMode({
        presenceSettings: {},
        workspaceSettings: {},
      }),
      "tool",
    );
  });
});
