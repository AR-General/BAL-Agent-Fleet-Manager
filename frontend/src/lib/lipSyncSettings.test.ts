import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isLipSyncEnabled,
  LIP_SYNC_ENABLED_KEY,
  serializeLipSyncSettings,
} from "./lipSyncSettings.ts";

describe("lipSyncSettings", () => {
  it("defaults to enabled when settings are missing", () => {
    assert.equal(isLipSyncEnabled(undefined), true);
    assert.equal(isLipSyncEnabled(null), true);
    assert.equal(isLipSyncEnabled({}), true);
  });

  it("reads an explicit off flag", () => {
    assert.equal(isLipSyncEnabled({ [LIP_SYNC_ENABLED_KEY]: false }), false);
  });

  it("round-trips the presence settings key", () => {
    const on = serializeLipSyncSettings(true);
    const off = serializeLipSyncSettings(false);
    assert.equal(on[LIP_SYNC_ENABLED_KEY], true);
    assert.equal(off[LIP_SYNC_ENABLED_KEY], false);
    assert.equal(isLipSyncEnabled(on), true);
    assert.equal(isLipSyncEnabled(off), false);
  });
});
