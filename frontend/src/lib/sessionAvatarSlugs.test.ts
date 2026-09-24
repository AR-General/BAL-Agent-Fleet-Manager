import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sessionAvatarSlugs } from "./sessionAvatarSlugs.ts";
import type { Session } from "../components/chat/types.ts";

function session(partial: Partial<Session>): Session {
  return {
    id: "s1",
    title: "t",
    status: "active",
    origin: "human",
    sessionType: "direct",
    modelId: null,
    pinned: false,
    participantInstanceSlugs: [],
    updatedAt: null,
    createdAt: null,
    ...partial,
  };
}

describe("sessionAvatarSlugs", () => {
  it("returns one slug for DM", () => {
    assert.deepEqual(
      sessionAvatarSlugs(
        session({
          sessionType: "direct",
          participantInstanceSlugs: ["selene", "nox"],
          primarySlug: "selene",
        }),
      ),
      ["selene"],
    );
  });

  it("falls back to first participant when primary missing", () => {
    assert.deepEqual(
      sessionAvatarSlugs(session({ sessionType: "direct", participantInstanceSlugs: ["nox"] })),
      ["nox"],
    );
  });

  it("returns up to four slugs for groups", () => {
    assert.deepEqual(
      sessionAvatarSlugs(
        session({
          sessionType: "group",
          participantInstanceSlugs: ["a", "b", "c", "d", "e"],
        }),
      ),
      ["a", "b", "c", "d"],
    );
  });

  it("treats single-participant group as one icon", () => {
    assert.deepEqual(
      sessionAvatarSlugs(session({ sessionType: "group", participantInstanceSlugs: ["xeni"] })),
      ["xeni"],
    );
  });
});
