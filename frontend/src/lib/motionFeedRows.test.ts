import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CharacterActionEvent } from "@openclaw/character-kit";
import { flattenMotionFeedRows, groupMotionFeedEvents } from "./motionFeedRows.ts";

function ev(
  partial: Partial<CharacterActionEvent> & Pick<CharacterActionEvent, "id">,
): CharacterActionEvent {
  return {
    at: partial.id,
    dtMs: 0,
    op: "gesture",
    label: `a${partial.id}`,
    source: "routine",
    status: "done",
    ...partial,
  };
}

describe("motionFeedRows", () => {
  it("keeps ungrouped events as separate rows without a series banner", () => {
    const events = [ev({ id: 3 }), ev({ id: 2 }), ev({ id: 1 })];
    const rows = flattenMotionFeedRows(groupMotionFeedEvents(events));
    assert.deepEqual(
      rows.map((row) => (row.kind === "event" ? row.event.id : row.kind)),
      [3, 2, 1],
    );
  });

  it("does not treat a single groupId event as a series", () => {
    const rows = flattenMotionFeedRows(groupMotionFeedEvents([ev({ id: 1, groupId: 9 })]));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.kind, "event");
  });

  it("inserts a series banner and chronological steps for consecutive groupId rows", () => {
    // Newest-first feed: wave (3), wait (2), nod (1) — same sequence.
    const events = [
      ev({ id: 3, groupId: 4, op: "gesture", label: "wave", source: "agent" }),
      ev({ id: 2, groupId: 4, op: "wait", label: "400ms", source: "agent" }),
      ev({ id: 1, groupId: 4, op: "gesture", label: "nod", source: "agent" }),
      ev({ id: 0, source: "routine", label: "think" }),
    ];
    const rows = flattenMotionFeedRows(groupMotionFeedEvents(events));
    assert.equal(rows[0]?.kind, "series");
    if (rows[0]?.kind !== "series") throw new Error("expected series");
    assert.equal(rows[0].groupId, 4);
    assert.equal(rows[0].count, 3);

    const steps = rows.slice(1, 4);
    assert.deepEqual(
      steps.map((row) => {
        if (row.kind !== "event") throw new Error("expected event");
        return { id: row.event.id, step: row.step, chain: row.chain, label: row.event.label };
      }),
      [
        { id: 1, step: 1, chain: "first", label: "nod" },
        { id: 2, step: 2, chain: "mid", label: "400ms" },
        { id: 3, step: 3, chain: "last", label: "wave" },
      ],
    );
    assert.equal(rows[4]?.kind, "event");
    if (rows[4]?.kind !== "event") throw new Error("expected event");
    assert.equal(rows[4].event.id, 0);
    assert.equal(rows[4].chain, undefined);
  });

  it("does not merge the same groupId across different agents", () => {
    const events = [
      ev({ id: 4, groupId: 1, agent: "beta", label: "beta-b" }),
      ev({ id: 3, groupId: 1, agent: "alpha", label: "alpha-b" }),
      ev({ id: 2, groupId: 1, agent: "alpha", label: "alpha-a" }),
      ev({ id: 1, groupId: 1, agent: "beta", label: "beta-a" }),
    ];
    const rows = flattenMotionFeedRows(groupMotionFeedEvents(events));
    const kinds = rows.map((row) =>
      row.kind === "series" ? `series-${row.groupId}` : row.event.label,
    );
    assert.deepEqual(kinds, ["beta-b", "series-1", "alpha-a", "alpha-b", "beta-a"]);
  });

  it("splits adjacent sequences with different groupIds", () => {
    const events = [
      ev({ id: 4, groupId: 2, label: "b2" }),
      ev({ id: 3, groupId: 2, label: "b1" }),
      ev({ id: 2, groupId: 1, label: "a2" }),
      ev({ id: 1, groupId: 1, label: "a1" }),
    ];
    const rows = flattenMotionFeedRows(groupMotionFeedEvents(events));
    const kinds = rows.map((row) => (row.kind === "series" ? `series-${row.groupId}` : row.event.label));
    assert.deepEqual(kinds, ["series-2", "b1", "b2", "series-1", "a1", "a2"]);
  });
});
