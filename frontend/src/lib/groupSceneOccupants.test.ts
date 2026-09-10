import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildGroupOccupants, mergeOccupantPoses, resolveGroupSpeakerSlug } from "./groupSceneOccupants.ts";
import type { AgentPresence } from "./participantPresence.ts";

function presence(slug: string, online = true, status = "healthy"): AgentPresence {
  return { slug, online, status, latency_ms: 12, last_seen: null };
}

describe("buildGroupOccupants", () => {
  it("keeps each occupant's own mood instead of a shared scene mood", () => {
    const occupants = buildGroupOccupants(
      ["beta", "delta"],
      [
        { slug: "beta", vrmUrl: "/beta.vrm", mood: "focused" },
        { slug: "delta", vrmUrl: "/delta.vrm", mood: "playful" },
      ],
      {
        beta: presence("beta"),
        delta: presence("delta"),
      },
    );
    assert.equal(occupants[0]?.id, "beta");
    assert.equal(occupants[0]?.mood, "focused");
    assert.equal(occupants[1]?.id, "delta");
    assert.equal(occupants[1]?.mood, "playful");
    assert.equal(occupants.every((o) => o.present), true);
  });

  it("applies saved world poses without changing roster identity", () => {
    const occupants = buildGroupOccupants(
      ["beta"],
      [{ slug: "beta", vrmUrl: "/beta.vrm", mood: "focused" }],
      { beta: presence("beta") },
      [{ slug: "beta", x: 2.4, z: -1.1, facing: 0.8, present: true }],
    );
    assert.equal(occupants[0]?.x, 2.4);
    assert.equal(occupants[0]?.z, -1.1);
    assert.equal(occupants[0]?.facing, 0.8);
  });

  it("overlays live snapshot poses onto the current roster", () => {
    const occupants = buildGroupOccupants(
      ["beta"],
      [{ slug: "beta", vrmUrl: "/beta.vrm", mood: "focused" }],
      { beta: presence("beta") },
      [{ slug: "beta", x: 0, z: 0, facing: 0, present: true }],
    );
    const merged = mergeOccupantPoses(occupants, [
      { slug: "beta", x: 1.5, z: 0.2, facing: 1.1, present: true },
    ]);
    assert.equal(merged[0]?.x, 1.5);
    assert.equal(merged[0]?.z, 0.2);
    assert.equal(merged[0]?.facing, 1.1);
  });

  it("keeps the slot and drops the mesh when the agent is offline", () => {
    const occupants = buildGroupOccupants(
      ["beta"],
      [{ slug: "beta", vrmUrl: "/beta.vrm", mood: "focused" }],
      { beta: presence("beta", false, "down") },
    );
    assert.equal(occupants[0]?.present, false);
    assert.equal(occupants[0]?.vrmUrl, null);
    assert.equal(occupants[0]?.mood, "focused");
  });
});

describe("resolveGroupSpeakerSlug", () => {
  it("prefers the TTS author, then the live agent, then the selected nametag", () => {
    assert.equal(
      resolveGroupSpeakerSlug("delta", "beta", "alpha", ["beta", "delta", "alpha"]),
      "delta",
    );
    assert.equal(
      resolveGroupSpeakerSlug(undefined, "beta", "alpha", ["beta", "delta", "alpha"]),
      "beta",
    );
    assert.equal(
      resolveGroupSpeakerSlug(undefined, undefined, "alpha", ["beta", "delta", "alpha"]),
      "alpha",
    );
    assert.equal(resolveGroupSpeakerSlug("missing", undefined, null, ["beta"]), "beta");
  });
});
