import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  longestCommonPrefixLength,
  readPresenceTtsSpeakModeOverride,
  resolveEffectiveTtsSpeakMode,
  serializePresenceTtsSpeakMode,
  workspaceTtsSpeakMode,
} from "./ttsSpeakMode.ts";

describe("ttsSpeakMode", () => {
  it("resolves effective mode from presence override then workspace", () => {
    assert.equal(
      resolveEffectiveTtsSpeakMode({
        presenceSettings: { tts_speak_mode: "tool" },
        workspaceMode: "auto",
      }),
      "tool",
    );
    assert.equal(
      resolveEffectiveTtsSpeakMode({
        presenceSettings: { tts_speak_mode: "inherit" },
        workspaceMode: "tool",
      }),
      "tool",
    );
    assert.equal(workspaceTtsSpeakMode({ tts_speak_mode: "auto" }), "auto");
  });

  it("serializes presence override including inherit", () => {
    assert.deepEqual(serializePresenceTtsSpeakMode("inherit"), {
      tts_speak_mode: "inherit",
    });
    assert.equal(readPresenceTtsSpeakModeOverride({ tts_speak_mode: "auto" }), "auto");
    assert.equal(readPresenceTtsSpeakModeOverride({}), "inherit");
  });

  it("recovers spoken offset via longest common prefix when text shortens", () => {
    assert.equal(longestCommonPrefixLength("Hello [grin world", "Hello world"), 6);
    assert.equal(longestCommonPrefixLength("abc", "xyz"), 0);
    assert.equal(longestCommonPrefixLength("same", "same"), 4);
  });
});
