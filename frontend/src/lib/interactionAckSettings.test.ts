import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseInteractionAckSettings,
  serializeInteractionAckSettings,
} from "./interactionAckSettings.ts";

describe("interactionAckSettings", () => {
  it("defaults to nod on click and v_sign in / wave out", () => {
    const ack = parseInteractionAckSettings(undefined);
    assert.equal(ack.clickEnabled, true);
    assert.equal(ack.clickGesture, "nod");
    assert.equal(ack.clickSpeed, 0.7);
    assert.equal(ack.zoomEnabled, true);
    assert.equal(ack.zoomInGesture, "v_sign");
    assert.equal(ack.zoomOutGesture, "wave");
  });

  it("round-trips presence settings keys", () => {
    const raw = serializeInteractionAckSettings({
      clickEnabled: false,
      clickGesture: "think",
      clickSpeed: 1.2,
      zoomEnabled: true,
      zoomInGesture: "wave",
      zoomOutGesture: "nod",
    });
    const parsed = parseInteractionAckSettings(raw);
    assert.equal(parsed.clickEnabled, false);
    assert.equal(parsed.clickGesture, "think");
    assert.equal(parsed.clickSpeed, 1.2);
    assert.equal(parsed.zoomInGesture, "wave");
    assert.equal(parsed.zoomOutGesture, "nod");
  });
});
