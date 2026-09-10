import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  enrichLlmOptions,
  formatUsdPerM,
  intelTone,
  lookupLlmMeta,
  priceTone,
  type LlmMetaRow,
} from "./llmModelMeta.ts";

describe("llmModelMeta", () => {
  const rows: LlmMetaRow[] = [
    {
      key: "claude-sonnet-5",
      slug: "claude-sonnet-5",
      name: "Claude Sonnet 5",
      intelligence: 42.5,
      input_per_m: 3,
      output_per_m: 15,
    },
  ];

  it("enriches catalog rows from Artificial Analysis / pricing meta", () => {
    const hit = lookupLlmMeta("openrouter:anthropic/claude-sonnet-5", rows);
    assert.equal(hit?.intelligence, 42.5);
    const enriched = enrichLlmOptions([{ id: "openrouter:anthropic/claude-sonnet-5" }], rows);
    assert.equal(enriched[0]?.input_per_m, 3);
    assert.equal(enriched[0]?.output_per_m, 15);
  });

  it("formats prices and tones", () => {
    assert.equal(formatUsdPerM(0), "free");
    assert.equal(formatUsdPerM(null), "—");
    assert.equal(priceTone(0.1), "low");
    assert.equal(priceTone(12), "high");
    assert.equal(intelTone(50), "top");
    assert.equal(intelTone(null), "unknown");
  });
});
