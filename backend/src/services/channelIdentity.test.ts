import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildChannelSystemPrompt } from "./channelIdentity.js";

describe("buildChannelSystemPrompt", () => {
  it("lists every group participant so the agent does not think it is alone", () => {
    const prompt = buildChannelSystemPrompt({
      agentSlug: "alpha",
      identity: { verified: false },
      sessionType: "group",
      participantSlugs: ["alpha", "beta", "delta"],
      primarySlug: "alpha",
      replyPolicy: "human_only",
    });
    assert.match(prompt, /GROUP room/);
    assert.match(prompt, /@alpha/);
    assert.match(prompt, /@beta/);
    assert.match(prompt, /@delta/);
    assert.match(prompt, /not alone/i);
    assert.match(prompt, /primary responder/i);
    assert.match(prompt, /@mentioned/);
  });

  it("when the 3D viewport is open, lists approach tags and live occupant poses", () => {
    const prompt = buildChannelSystemPrompt({
      agentSlug: "alpha",
      identity: { verified: false },
      viewport3dActive: true,
      sessionType: "group",
      participantSlugs: ["alpha", "gamma"],
      sceneOccupants: [
        { slug: "alpha", x: 0, z: 0, facing: 0, present: true },
        { slug: "gamma", x: 1.4, z: 0, facing: 0, present: true },
      ],
    });
    assert.match(prompt, /\[approach:@slug\]/);
    assert.match(prompt, /@gamma at x=1\.4/);
    assert.match(prompt, /Do not claim they are absent/);
  });

  it("tells mentioned_only rooms to wait for explicit mentions", () => {
    const prompt = buildChannelSystemPrompt({
      agentSlug: "alpha",
      identity: { verified: false },
      sessionType: "group",
      participantSlugs: ["alpha", "beta"],
      primarySlug: "alpha",
      replyPolicy: "mentioned_only",
    });
    assert.match(prompt, /mentioned_only/);
    assert.match(prompt, /wait for an explicit @mention/i);
  });

  it("stays a single-agent channel when there are no peers", () => {
    const prompt = buildChannelSystemPrompt({
      agentSlug: "alpha",
      identity: { verified: false },
      sessionType: "direct",
      participantSlugs: ["alpha"],
    });
    assert.doesNotMatch(prompt, /GROUP room/);
    assert.match(prompt, /Agent slug: @alpha/);
  });

  it("adds character_speak guidance when ttsSpeakMode is tool", () => {
    const prompt = buildChannelSystemPrompt({
      agentSlug: "alpha",
      identity: { verified: false },
      ttsSpeakMode: "tool",
    });
    assert.match(prompt, /character_speak/);
    assert.match(prompt, /Spoken lines must use the character_speak tool/i);
  });

  it("omits character_speak guidance in auto mode", () => {
    const prompt = buildChannelSystemPrompt({
      agentSlug: "alpha",
      identity: { verified: false },
      ttsSpeakMode: "auto",
    });
    assert.doesNotMatch(prompt, /character_speak/);
  });
});
