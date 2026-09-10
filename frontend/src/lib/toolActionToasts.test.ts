import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectViewportToolEvents,
  expireToolActionToasts,
  toolActionKind,
  toolActionLabel,
  upsertToolActionToast,
} from "./toolActionToasts.ts";

describe("toolActionToasts", () => {
  it("maps character and search tools to compact kinds", () => {
    assert.equal(toolActionKind("character_play_gesture"), "gesture");
    assert.equal(toolActionKind("character.play_gesture"), "gesture");
    assert.equal(toolActionKind("web_search", "search docs"), "search");
    assert.equal(toolActionKind("shell", "run ls"), "shell");
    assert.equal(toolActionKind("character_set_mood"), "mood");
  });

  it("stacks repeats of the same kind and appends a new kind", () => {
    const t0 = 1_000;
    let stack = upsertToolActionToast([], { id: "a", tool: "web_search", label: "search" }, t0);
    stack = upsertToolActionToast(stack, { id: "b", tool: "web_search", label: "search" }, t0 + 10);
    assert.equal(stack.length, 1);
    assert.equal(stack[0]?.count, 2);
    assert.equal(stack[0]?.kind, "search");

    stack = upsertToolActionToast(
      stack,
      { id: "c", tool: "character_play_gesture", label: "wave" },
      t0 + 20,
    );
    assert.equal(stack.length, 2);
    assert.equal(stack[1]?.kind, "gesture");
    assert.equal(stack[1]?.count, 1);

    stack = upsertToolActionToast(
      stack,
      { id: "c", tool: "character_play_gesture", label: "wave", status: "done" },
      t0 + 30,
      { bumpCount: false },
    );
    assert.equal(stack[1]?.count, 1);
    assert.equal(stack[1]?.status, "done");
  });

  it("uses a short kind label when the raw label is long", () => {
    assert.equal(
      toolActionLabel("search", "Searching the whole knowledge base for related PRs"),
      "search",
    );
    assert.equal(toolActionLabel("gesture", "wave"), "wave");
  });

  it("never returns an unbounded last-segment label", () => {
    const preview = toolActionLabel(
      "custom",
      undefined,
      "this-is-an-extremely-long-unsegmented-tool-progress-string-that-used-to-fill-the-page",
    );
    assert.ok(preview.length <= 22);
    assert.equal(preview.endsWith("…"), true);
  });

  it("marks expired toasts as leaving then drops them", () => {
    let stack = upsertToolActionToast([], { id: "a", tool: "shell" }, 0);
    stack = expireToolActionToasts(stack, stack[0]!.expiresAt);
    assert.equal(stack[0]?.leaving, true);
    stack = expireToolActionToasts(stack, stack[0]!.expiresAt + 400);
    assert.equal(stack.length, 0);
  });

  it("collects tool calls from chat messages with author slug", () => {
    const events = collectViewportToolEvents([
      {
        authorSlug: "beta",
        toolCalls: [{ id: "1", tool: "web_search", label: "search", status: "running" }],
      },
    ]);
    assert.equal(events[0]?.authorSlug, "beta");
    assert.equal(events[0]?.tool, "web_search");
  });
});
