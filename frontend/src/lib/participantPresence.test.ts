import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatLatencyMs,
  presenceFromInstance,
  presenceLabel,
  presenceTone,
  presenceToneHex,
} from "./participantPresence.ts";

describe("participantPresence", () => {
  it("formats RTT and maps stored instance health to online/offline", () => {
    assert.equal(formatLatencyMs(42.4), "42ms");
    assert.equal(formatLatencyMs(null), "—");

    const online = presenceFromInstance({
      slug: "alpha",
      lastSeen: "2026-09-05T08:00:00.000Z",
      health: { status: "healthy", response_time_ms: 19, last_ping: "2026-09-05T08:01:00.000Z" },
    });
    assert.equal(online.online, true);
    assert.equal(online.latency_ms, 19);
    assert.equal(presenceLabel(online), "online");
    assert.equal(presenceTone(online.status, online.online), "healthy");

    const down = presenceFromInstance({
      slug: "beta",
      health: { status: "down", last_error: "ECONNREFUSED" },
    });
    assert.equal(down.online, false);
    assert.equal(down.latency_ms, null);
    assert.equal(presenceLabel(down), "offline");
    assert.equal(presenceTone(down.status, down.online), "down");
    assert.equal(presenceToneHex("healthy"), 0x3dd68c);
    assert.equal(presenceToneHex("down"), 0xff6666);
  });
});
