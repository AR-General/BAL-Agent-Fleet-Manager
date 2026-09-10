import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_TOOL_CALLS_DEFAULT, clampMaxToolCalls } from "./chatToolCalls.ts";

describe("clampMaxToolCalls", () => {
  it("defaults and clamps the DM tool-call budget", () => {
    assert.equal(clampMaxToolCalls(undefined), MAX_TOOL_CALLS_DEFAULT);
    assert.equal(clampMaxToolCalls(0), 1);
    assert.equal(clampMaxToolCalls(50), 50);
    assert.equal(clampMaxToolCalls(500), 200);
  });
});
