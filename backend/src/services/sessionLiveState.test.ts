import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySessionEvent,
  cancelAllSessionLive,
  cancelAuthorSessionLive,
  clearSessionLive,
  getSessionLive,
  snapshotForClient,
} from "./sessionLiveState.js";

describe("sessionLiveState", () => {
  it("tracks thinking → writing → done and clears the stream", () => {
    const id = "sess-1";
    clearSessionLive(id);

    applySessionEvent(id, {
      type: "agent_status",
      state: "thinking",
      author_slug: "alpha",
      message_id: "stream-1",
    });
    applySessionEvent(id, {
      type: "message_delta",
      message_id: "stream-1",
      author_slug: "alpha",
      content: "Hello",
      role: "assistant",
      author_type: "instance",
    });
    let live = getSessionLive(id);
    assert.equal(live.generating, true);
    assert.equal(live.agentStatus?.state, "thinking");
    assert.equal(live.stream?.content, "Hello");

    applySessionEvent(id, {
      type: "agent_status",
      state: "writing",
      author_slug: "alpha",
      message_id: "stream-1",
    });
    live = getSessionLive(id);
    assert.equal(live.generating, true);
    assert.equal(live.agentStatus?.state, "writing");

    applySessionEvent(id, {
      type: "message_done",
      message_id: "msg-1",
      stream_id: "stream-1",
      author_slug: "alpha",
    });
    live = getSessionLive(id);
    assert.equal(live.generating, false);
    assert.equal(live.stream, null);
    assert.equal(live.agentStatus?.state, "done");
  });

  it("keeps generating while a second agent is still streaming", () => {
    const id = "sess-parallel";
    clearSessionLive(id);
    applySessionEvent(id, {
      type: "agent_status",
      state: "thinking",
      author_slug: "alpha",
      message_id: "s1",
    });
    applySessionEvent(id, {
      type: "agent_status",
      state: "thinking",
      author_slug: "beta",
      message_id: "s2",
    });
    applySessionEvent(id, {
      type: "message_done",
      message_id: "m1",
      stream_id: "s1",
      author_slug: "alpha",
    });
    const live = getSessionLive(id);
    assert.equal(live.generating, true);
    assert.equal(live.agentStatuses.beta?.state, "thinking");
    assert.equal(live.agentStatuses.alpha?.state, "done");
  });

  it("treats backend-restart empty snapshot as not generating", () => {
    const id = "sess-missing";
    clearSessionLive(id);
    const snap = snapshotForClient(id);
    assert.equal(snap.generating, false);
    assert.equal(snap.agent_status, null);
    assert.equal(snap.stream, null);
    assert.equal(snap.session_id, id);
  });

  it("keeps partial stream text across status changes so reconnect can restore it", () => {
    const id = "sess-2";
    clearSessionLive(id);
    applySessionEvent(id, {
      type: "message_delta",
      message_id: "stream-2",
      content: "partial reply",
      author_slug: "beta",
      role: "assistant",
      author_type: "instance",
    });
    applySessionEvent(id, {
      type: "agent_status",
      state: "writing",
      author_slug: "beta",
      message_id: "stream-2",
    });
    const snap = snapshotForClient(id);
    assert.equal(snap.generating, true);
    const stream = snap.stream as { content: string; message_id: string };
    assert.equal(stream.content, "partial reply");
    assert.equal(stream.message_id, "stream-2");
  });

  it("cancelAllSessionLive clears generating for every author", () => {
    const id = "sess-stop-all";
    clearSessionLive(id);
    applySessionEvent(id, {
      type: "agent_status",
      state: "thinking",
      author_slug: "alpha",
      message_id: "s1",
    });
    applySessionEvent(id, {
      type: "agent_status",
      state: "writing",
      author_slug: "beta",
      message_id: "s2",
    });
    const live = cancelAllSessionLive(id);
    assert.equal(live.generating, false);
    assert.equal(live.agentStatuses.alpha?.state, "cancelled");
    assert.equal(live.agentStatuses.beta?.state, "cancelled");
    assert.equal(Object.keys(live.streams).length, 0);
  });

  it("cancelAuthorSessionLive only clears one agent", () => {
    const id = "sess-stop-one";
    clearSessionLive(id);
    applySessionEvent(id, {
      type: "agent_status",
      state: "thinking",
      author_slug: "alpha",
      message_id: "s1",
    });
    applySessionEvent(id, {
      type: "message_delta",
      message_id: "s1",
      author_slug: "alpha",
      content: "hi",
      role: "assistant",
      author_type: "instance",
    });
    applySessionEvent(id, {
      type: "agent_status",
      state: "thinking",
      author_slug: "beta",
      message_id: "s2",
    });
    const live = cancelAuthorSessionLive(id, "alpha");
    assert.equal(live.agentStatuses.alpha?.state, "cancelled");
    assert.equal(live.agentStatuses.beta?.state, "thinking");
    assert.equal(live.generating, true);
    assert.equal(live.streams.s1, undefined);
  });
});
