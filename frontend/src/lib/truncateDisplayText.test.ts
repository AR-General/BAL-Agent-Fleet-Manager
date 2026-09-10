import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { truncateDisplayText } from "./truncateDisplayText.ts";

describe("truncateDisplayText", () => {
  it("leaves short text alone", () => {
    assert.deepEqual(truncateDisplayText("shell ls"), { preview: "shell ls", truncated: false });
  });

  it("collapses whitespace and truncates long tool labels", () => {
    const raw = "  Searching the whole knowledge base for related PRs  and more  ";
    const next = truncateDisplayText(raw, 24);
    assert.equal(next.truncated, true);
    assert.equal(next.preview.endsWith("…"), true);
    assert.ok(next.preview.length <= 24);
  });
});
