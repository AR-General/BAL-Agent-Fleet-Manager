import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_TOOL_CALLS_DEFAULT,
  clampMaxToolCalls,
  hermesStreamTimeoutMs,
} from "./chatToolCalls.ts";

describe("clampMaxToolCalls", () => {
  it("defaults, floors, and clamps", () => {
    assert.equal(clampMaxToolCalls(undefined), MAX_TOOL_CALLS_DEFAULT);
    assert.equal(clampMaxToolCalls("nope"), MAX_TOOL_CALLS_DEFAULT);
    assert.equal(clampMaxToolCalls(0), 1);
    assert.equal(clampMaxToolCalls(50), 50);
    assert.equal(clampMaxToolCalls(999), 200);
  });
});

describe("hermesStreamTimeoutMs", () => {
  it("scales with the tool-call budget and stays bounded", () => {
    assert.equal(hermesStreamTimeoutMs(1), 180_000);
    assert.equal(hermesStreamTimeoutMs(50), 600_000);
    assert.equal(hermesStreamTimeoutMs(200), 1_800_000);
  });
});
