import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseAgentAvatarSnapshot,
  readAgentAvatar,
  writeAgentAvatar,
} from "./agentAvatarStore.ts";

describe("agentAvatarStore", () => {
  it("parses camelCase or snake_case presence rows", () => {
    const snap = parseAgentAvatarSnapshot({
      vrmUrl: "/dev-vrm-assets/vrm/tori.vrm",
      defaultMood: "playful",
      pointerLook: false,
      fishVoiceId: "abc",
      clothes: { clothesId: "default" },
      settings: { catalog_id: "tori" },
    });
    assert.ok(snap);
    assert.equal(snap.vrm_url, "/dev-vrm-assets/vrm/tori.vrm");
    assert.equal(snap.default_mood, "playful");
    assert.equal(snap.pointer_look, false);
    assert.equal(snap.fish_voice_id, "abc");
  });

  it("remembers a snapshot per slug in storage", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
    };
    writeAgentAvatar(
      "Alpha",
      {
        vrm_url: "/dev-vrm-assets/vrm/curt.vrm",
        default_mood: "focused",
        pointer_look: true,
        fish_voice_id: "",
        clothes: {},
        settings: { catalog_id: "curt" },
      },
      storage,
    );
    writeAgentAvatar(
      "beta",
      {
        vrm_url: "/dev-vrm-assets/vrm/tori.vrm",
        default_mood: "neutral",
        pointer_look: true,
        fish_voice_id: "",
        clothes: {},
        settings: { catalog_id: "tori" },
      },
      storage,
    );
    const loaded = readAgentAvatar("alpha", storage);
    assert.equal(loaded?.vrm_url, "/dev-vrm-assets/vrm/curt.vrm");
    assert.equal(loaded?.settings.catalog_id, "curt");
    assert.equal(readAgentAvatar("BETA", storage)?.vrm_url, "/dev-vrm-assets/vrm/tori.vrm");
  });

  it("does not persist blob object URLs", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
    };
    writeAgentAvatar(
      "delta",
      {
        vrm_url: "blob:https://portal/1",
        default_mood: "neutral",
        pointer_look: true,
        fish_voice_id: "",
        clothes: {},
        settings: {},
      },
      storage,
    );
    assert.equal(readAgentAvatar("delta", storage)?.vrm_url, "");
  });
});
