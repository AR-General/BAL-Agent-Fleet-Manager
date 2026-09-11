import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getViewportEntities,
  getViewportOccupants,
  isViewport3dActive,
  setViewport3dActive,
  setViewportEntities,
  setViewportOccupants,
} from "./viewportSession.js";

describe("viewportSession", () => {
  it("keeps occupant poses after the 3D view is marked inactive", () => {
    const id = `sess-keep-${Date.now()}-${Math.random()}`;
    setViewport3dActive(id, true);
    setViewportOccupants(id, [
      { slug: "gamma", x: 1.4, z: -0.5, facing: 0.8, present: true },
    ]);
    setViewport3dActive(id, false);
    assert.equal(isViewport3dActive(id), false);
    assert.deepEqual(getViewportOccupants(id), [
      { slug: "gamma", x: 1.4, z: -0.5, facing: 0.8, present: true },
    ]);
  });

  it("reactivates without dropping the last snapshot", () => {
    const id = `sess-reactivate-${Date.now()}-${Math.random()}`;
    setViewportOccupants(id, [{ slug: "delta", x: 2, z: 0, facing: 0, present: true }]);
    setViewport3dActive(id, false);
    setViewport3dActive(id, true);
    assert.equal(isViewport3dActive(id), true);
    assert.equal(getViewportOccupants(id)[0]?.slug, "delta");
  });

  it("stores entity digests independently of occupants", () => {
    const id = `sess-entities-${Date.now()}-${Math.random()}`;
    setViewportOccupants(id, [{ slug: "alpha", x: 0, z: 0, facing: 0, present: true }]);
    setViewportEntities(id, [
      { id: "obj_1", kind: "object", label: "box", x: 1, y: 0, z: 2, yaw: 0 },
    ]);
    assert.equal(getViewportEntities(id)[0]?.id, "obj_1");
    assert.equal(getViewportOccupants(id)[0]?.slug, "alpha");
  });
});
