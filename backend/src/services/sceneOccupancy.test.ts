import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatViewportMotionPrompt,
  mergeRosterIntoOccupants,
  normalizeOccupantPoses,
  occupantPoseKey,
} from "./sceneOccupancy.js";

describe("normalizeOccupantPoses", () => {
  it("dedupes slugs and fills numeric defaults", () => {
    const poses = normalizeOccupantPoses([
      { slug: "gamma", x: 1.25, z: -0.4, facing: 1.57, present: true },
      { slug: "gamma", x: 9, z: 9 },
      { id: "alpha", present: false },
    ]);
    assert.deepEqual(poses, [
      { slug: "gamma", x: 1.25, z: -0.4, facing: 1.57, present: true },
      { slug: "alpha", x: 0, z: 0, facing: 0, present: false },
    ]);
  });
});

describe("formatViewportMotionPrompt", () => {
  it("lists live poses and forbids claiming a listed peer is missing", () => {
    const text = formatViewportMotionPrompt({
      selfSlug: "alpha",
      roster: ["alpha", "gamma"],
      occupants: [
        { slug: "alpha", x: 0, z: 0, facing: 0, present: true },
        { slug: "gamma", x: 1.4, z: 0, facing: 0, present: true },
      ],
    });
    assert.match(text, /\[approach:@slug\]/);
    assert.match(text, /Walk\/approach are tags/);
    assert.match(text, /@gamma at x=1\.4 z=0\.0/);
    assert.match(text, /@alpha \(you\)/);
    assert.match(text, /Do not claim they are absent/);
  });

  it("falls back to roster when poses have not arrived yet", () => {
    const text = formatViewportMotionPrompt({
      selfSlug: "alpha",
      roster: ["alpha", "gamma", "beta"],
      occupants: [],
    });
    assert.match(text, /@gamma/);
    assert.match(text, /@beta/);
    assert.match(text, /just joined, pose pending/);
    assert.match(text, /\[approach:@slug\]/);
  });

  it("keeps a newly joined roster member even if the last snapshot omitted them", () => {
    const text = formatViewportMotionPrompt({
      selfSlug: "alpha",
      roster: ["alpha", "gamma", "beta"],
      occupants: [
        { slug: "alpha", x: 0, z: 0, facing: 0, present: true },
        { slug: "gamma", x: 1.4, z: 0, facing: 0, present: true },
      ],
    });
    assert.match(text, /@beta at x=0\.0/);
    assert.match(text, /just joined, pose pending/);
    assert.doesNotMatch(text, /Treat listed peers as visible/);
  });
});

describe("occupantPoseKey", () => {
  it("changes when someone walks", () => {
    const a = occupantPoseKey([{ slug: "gamma", x: 0, z: 0, facing: 0, present: true }]);
    const b = occupantPoseKey([{ slug: "gamma", x: 1.2, z: 0, facing: 0, present: true }]);
    assert.notEqual(a, b);
  });
});

describe("mergeRosterIntoOccupants", () => {
  it("adds missing members and drops leavers", () => {
    const merged = mergeRosterIntoOccupants(
      ["alpha", "beta"],
      [
        { slug: "alpha", x: 1, z: 2, facing: 0.5, present: true },
        { slug: "delta", x: 9, z: 9, facing: 0, present: true },
      ],
    );
    assert.deepEqual(merged, [
      { slug: "alpha", x: 1, z: 2, facing: 0.5, present: true },
      { slug: "beta", x: 0, z: 0, facing: 0, present: true },
    ]);
  });
});
