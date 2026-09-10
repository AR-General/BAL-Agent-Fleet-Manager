import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dropSlugJobs, dropStaleSlugJobs } from "./ttsSpeakQueue.ts";

describe("dropStaleSlugJobs", () => {
  it("keeps other speakers and the current message for this slug", () => {
    const queue = [
      { slug: "alpha", messageId: "a", text: "hi", voiceId: "v", cues: [] },
      { slug: "gamma", messageId: "b", text: "yo", voiceId: "v", cues: [] },
      { slug: "alpha", messageId: "c", text: "later", voiceId: "v", cues: [] },
    ];
    const next = dropStaleSlugJobs(queue, "alpha", "c");
    assert.equal(next.length, 2);
    assert.equal(next[0]?.slug, "gamma");
    assert.equal(next[1]?.messageId, "c");
  });
});

describe("dropSlugJobs", () => {
  it("removes only that speaker", () => {
    const queue = [
      { slug: "alpha", messageId: "a", text: "hi", voiceId: "v", cues: [] },
      { slug: "gamma", messageId: "b", text: "yo", voiceId: "v", cues: [] },
    ];
    assert.deepEqual(dropSlugJobs(queue, "alpha").map((j) => j.slug), ["gamma"]);
  });
});
