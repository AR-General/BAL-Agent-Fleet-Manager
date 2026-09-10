import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  lookupLlmMeta,
  matchKeysForModelId,
  normalizeModelKey,
  type LlmMetaRow,
} from "./llmModelMeta.js";

describe("llmModelMeta matching", () => {
  it("strips provider prefixes from Hermes model ids", () => {
    assert.equal(normalizeModelKey("openrouter:anthropic/claude-sonnet-5"), "anthropic/claude-sonnet-5");
    assert.equal(normalizeModelKey("anthropic/claude-sonnet-5:batch"), "anthropic/claude-sonnet-5");
  });

  it("looks up meta by leaf slug", () => {
    const rows: LlmMetaRow[] = [
      {
        key: "claude-sonnet-5",
        slug: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        intelligence: 40,
        input_per_m: 3,
        output_per_m: 15,
      },
    ];
    const hit = lookupLlmMeta("openrouter:anthropic/claude-sonnet-5", rows);
    assert.equal(hit?.intelligence, 40);
    assert.ok(matchKeysForModelId("openrouter:anthropic/claude-sonnet-5").includes("claude-sonnet-5"));
  });
});
