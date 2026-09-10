import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  loadScenePoses,
  parseScenePoses,
  saveScenePoses,
  scenePoseStorageKey,
} from "./scenePoseStorage.ts";

describe("parseScenePoses", () => {
  it("keeps finite x/z/facing and drops incomplete rows", () => {
    const poses = parseScenePoses([
      { slug: "gamma", x: 1.25, z: -0.4, facing: 1.57, present: true },
      { slug: "gamma", x: 9, z: 9, facing: 0 },
      { id: "alpha", x: 0, z: 1, facing: 0, present: false },
      { slug: "beta", x: Number.NaN, z: 0, facing: 0 },
    ]);
    assert.deepEqual(poses, [
      { slug: "gamma", x: 1.25, z: -0.4, facing: 1.57, present: true },
      { slug: "alpha", x: 0, z: 1, facing: 0, present: false },
    ]);
  });
});

describe("scenePoseStorage", () => {
  it("round-trips poses for a session key", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    const poses = [{ slug: "delta", x: 2, z: -1, facing: 0.5, present: true }];
    saveScenePoses("sess-1", poses, storage);
    assert.equal(store.has(scenePoseStorageKey("sess-1")), true);
    assert.deepEqual(loadScenePoses("sess-1", storage), poses);
    assert.deepEqual(loadScenePoses("other", storage), []);
  });
});
