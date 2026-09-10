import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatTokenCount, formatUsd, normalizeTokenSpend } from "./tokenSpend.ts";

describe("tokenSpend", () => {
  it("formats tiny and typical USD amounts", () => {
    assert.equal(formatUsd(0), "$0.00");
    assert.equal(formatUsd(0.0042), "$0.0042");
    assert.equal(formatUsd(1.234), "$1.23");
  });

  it("formats compact token counts", () => {
    assert.equal(formatTokenCount(12), "12");
    assert.equal(formatTokenCount(1500), "1.5k");
    assert.equal(formatTokenCount(12_400), "12k");
  });

  it("normalizes API payloads", () => {
    const spend = normalizeTokenSpend({
      total_usd: 0.12,
      total_prompt_tokens: 100,
      total_completion_tokens: 50,
      estimated: true,
      participants: [{ slug: "alpha", usd: 0.12, prompt_tokens: 100, completion_tokens: 50, calls: 2 }],
    });
    assert.equal(spend.participants[0]?.slug, "alpha");
    assert.equal(spend.total_usd, 0.12);
  });
});
