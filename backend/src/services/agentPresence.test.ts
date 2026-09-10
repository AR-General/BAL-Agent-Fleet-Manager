import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isReachableHealthStatus,
  presenceFromPing,
  presenceFromStoredHealth,
} from "./agentPresence.js";

describe("agentPresence", () => {
  it("treats healthy and degraded as online with live RTT", () => {
    assert.equal(isReachableHealthStatus("healthy", true), true);
    assert.equal(isReachableHealthStatus("degraded", true), true);
    assert.equal(isReachableHealthStatus("down", false), false);

    const healthy = presenceFromPing("alpha", { ok: true, ms: 42, status: "healthy" });
    assert.equal(healthy.online, true);
    assert.equal(healthy.latency_ms, 42);

    const down = presenceFromPing("beta", {
      ok: false,
      ms: 8000,
      status: "down",
      error: "timeout",
    }, "2026-09-05T08:00:00.000Z");
    assert.equal(down.online, false);
    assert.equal(down.latency_ms, null);
    assert.equal(down.last_seen, "2026-09-05T08:00:00.000Z");
    assert.equal(down.error, "timeout");
  });

  it("reads stored health JSON for first paint before a live probe", () => {
    const row = presenceFromStoredHealth(
      "delta",
      { status: "healthy", response_time_ms: 18, last_ping: "2026-09-05T08:10:00.000Z" },
      "2026-09-05T08:10:00.000Z",
    );
    assert.equal(row.online, true);
    assert.equal(row.latency_ms, 18);
    assert.equal(row.last_seen, "2026-09-05T08:10:00.000Z");
  });
});
