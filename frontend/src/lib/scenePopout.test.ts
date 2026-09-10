import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isScenePopoutPath,
  parseScenePopoutMessage,
  scenePopoutPath,
  scenePopoutUrl,
  scenePopoutWindowName,
} from "./scenePopout.ts";

describe("scenePopout", () => {
  it("builds a same-origin scene path and window name", () => {
    assert.equal(scenePopoutPath("abc"), "/chat/abc/scene");
    assert.equal(scenePopoutWindowName("abc"), "oc-scene-abc");
    assert.equal(isScenePopoutPath("/chat/abc/scene"), true);
    assert.equal(isScenePopoutPath("/chat/abc"), false);
    assert.equal(scenePopoutUrl("abc", "http://localhost:3080"), "http://localhost:3080/chat/abc/scene");
  });

  it("accepts known channel payloads and drops junk", () => {
    assert.deepEqual(parseScenePopoutMessage({ type: "opened", sessionId: "s1" }), {
      type: "opened",
      sessionId: "s1",
    });
    assert.deepEqual(
      parseScenePopoutMessage({ type: "look-at", sessionId: "s1", slug: "gamma", token: 9 }),
      { type: "look-at", sessionId: "s1", slug: "gamma", token: 9 },
    );
    assert.equal(parseScenePopoutMessage({ type: "look-at", sessionId: "s1" }), null);
    assert.equal(parseScenePopoutMessage({ type: "nope", sessionId: "s1" }), null);
  });
});
