import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  coalesceAgentStatusPhase,
  isLiveAgentState,
  parseStatusMotions,
  pickStatusGesture,
  serializeStatusMotions,
  statusMood,
} from "./agentStatusGestures.ts";

describe("agentStatusGestures", () => {
  it("treats writing/thinking as live and done as terminal", () => {
    assert.equal(isLiveAgentState("writing"), true);
    assert.equal(isLiveAgentState("thinking"), true);
    assert.equal(isLiveAgentState("done"), false);
    assert.equal(isLiveAgentState("cancelled"), false);
  });

  it("coalesces tool-churn statuses into a stable running phase", () => {
    assert.equal(coalesceAgentStatusPhase("planning"), "running");
    assert.equal(coalesceAgentStatusPhase("reading"), "running");
    assert.equal(coalesceAgentStatusPhase("running"), "running");
    assert.equal(coalesceAgentStatusPhase("thinking"), "thinking");
    assert.equal(coalesceAgentStatusPhase("writing"), "writing");
    assert.equal(statusMood("planning"), statusMood("running"));
  });

  it("merges presence status_motions over defaults", () => {
    const merged = parseStatusMotions({
      status_motions: {
        thinking: { gestures: ["think", "stretch"], interval_ms: 6000 },
      },
    });
    assert.deepEqual(merged.thinking.gestures, ["think", "stretch"]);
    assert.equal(merged.thinking.intervalMs, 6000);
    assert.ok(merged.writing.gestures.includes("nod"));
  });

  it("picks randomly among several gestures and avoids the last id", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const id = pickStatusGesture(["think", "look_around"], "think");
      assert.equal(id, "look_around");
      seen.add(id!);
    }
    assert.equal(seen.size, 1);
  });

  it("round-trips serialize/parse", () => {
    const raw = serializeStatusMotions({
      thinking: { gestures: ["think"], intervalMs: 3000 },
    });
    const parsed = parseStatusMotions({ status_motions: raw });
    assert.deepEqual(parsed.thinking.gestures, ["think"]);
    assert.equal(parsed.thinking.intervalMs, 3000);
  });
});
