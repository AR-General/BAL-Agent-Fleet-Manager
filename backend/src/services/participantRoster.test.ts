import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  duplicateParticipantError,
  lastParticipantRemoveError,
  shouldPromoteToGroup,
} from "./participantRoster.js";

describe("participantRoster", () => {
  it("rejects a slug that is already in the room", () => {
    assert.equal(duplicateParticipantError(["a", "b"], "b"), "already a participant of this session");
    assert.equal(duplicateParticipantError(["a"], "c"), null);
  });

  it("refuses to remove the last agent", () => {
    assert.equal(lastParticipantRemoveError(1), "cannot remove the last agent participant");
    assert.equal(lastParticipantRemoveError(0), "cannot remove the last agent participant");
    assert.equal(lastParticipantRemoveError(2), null);
  });

  it("promotes a DM to group when a second agent joins", () => {
    assert.equal(shouldPromoteToGroup("direct", 2), true);
    assert.equal(shouldPromoteToGroup("direct", 1), false);
    assert.equal(shouldPromoteToGroup("group", 3), false);
  });
});
