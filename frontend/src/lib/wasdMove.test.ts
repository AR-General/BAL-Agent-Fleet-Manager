import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isWalkKey, stickFromHeldKeys } from "./wasdMove.ts";

describe("stickFromHeldKeys", () => {
  it("maps WASD to camera-relative stick like the scene controls", () => {
    assert.deepEqual(stickFromHeldKeys(["w"]), { x: 0, z: -1, yaw: 0, jump: false });
    assert.deepEqual(stickFromHeldKeys(["s", "d"]), { x: 1, z: 1, yaw: 0, jump: false });
    assert.deepEqual(stickFromHeldKeys([" "]), { x: 0, z: 0, yaw: 0, jump: true });
  });

  it("treats arrows as aliases", () => {
    assert.deepEqual(stickFromHeldKeys(["ArrowUp", "ArrowLeft"]), {
      x: -1,
      z: -1,
      yaw: 0,
      jump: false,
    });
  });
});

describe("isWalkKey", () => {
  it("accepts wasd, arrows, and space", () => {
    assert.equal(isWalkKey("w"), true);
    assert.equal(isWalkKey("ArrowDown"), true);
    assert.equal(isWalkKey(" "), true);
    assert.equal(isWalkKey("e"), false);
  });
});
