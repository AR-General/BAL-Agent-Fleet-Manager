import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregateTokenSpend, estimateUsdFromTokens, parseTokenUsage } from "./tokenUsage.js";

describe("parseTokenUsage", () => {
  it("prefers provider-reported cost", () => {
    const parsed = parseTokenUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cost: 0.0123,
    });
    assert.ok(parsed);
    assert.equal(parsed.cost_usd, 0.0123);
    assert.equal(parsed.estimated, false);
  });

  it("estimates USD when cost is missing", () => {
    const parsed = parseTokenUsage(
      { prompt_tokens: 1_000_000, completion_tokens: 0 },
      "anthropic/claude-sonnet-4",
    );
    assert.ok(parsed);
    assert.equal(parsed.estimated, true);
    assert.equal(parsed.cost_usd, 3);
  });

  it("returns null for empty usage", () => {
    assert.equal(parseTokenUsage({}), null);
    assert.equal(parseTokenUsage(null), null);
  });
});

describe("estimateUsdFromTokens", () => {
  it("uses sonnet rates", () => {
    assert.equal(estimateUsdFromTokens(0, 1_000_000, "openrouter/anthropic/claude-sonnet-4"), 15);
  });
});

describe("aggregateTokenSpend", () => {
  it("sums per participant", () => {
    const spend = aggregateTokenSpend([
      {
        slug: "alpha",
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
          cost_usd: 0.02,
          estimated: false,
        },
      },
      {
        slug: "alpha",
        usage: {
          prompt_tokens: 5,
          completion_tokens: 5,
          total_tokens: 10,
          cost_usd: 0.01,
          estimated: true,
        },
      },
      {
        slug: "beta",
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
          cost_usd: 0.005,
          estimated: false,
        },
      },
    ]);
    assert.equal(spend.participants.length, 2);
    assert.equal(spend.participants[0]?.slug, "alpha");
    assert.equal(spend.participants[0]?.calls, 2);
    assert.equal(spend.total_usd, 0.035);
    assert.equal(spend.estimated, true);
  });
});
