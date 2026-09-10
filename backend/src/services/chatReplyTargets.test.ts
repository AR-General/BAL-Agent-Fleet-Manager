import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyAutoTurnBudget,
  parseMentionTokens,
  selectReplyTargetIds,
  toHermesHistoryForAgent,
  clampMaxAgentAutoTurns,
} from "./chatReplyTargets.js";

const slugs = new Map([
  ["alpha-id", "alpha"],
  ["beta-id", "beta"],
  ["delta-id", "delta"],
  ["gamma-id", "gamma"],
]);

describe("parseMentionTokens", () => {
  it("parses room mentions and ignores email-like tokens", () => {
    const parsed = parseMentionTokens("hey @beta and alex@example.com @Delta");
    assert.equal(parsed.broadcast, false);
    assert.deepEqual(parsed.slugs, ["beta", "delta"]);
  });

  it("detects @all / @room / @everyone as broadcast", () => {
    assert.equal(parseMentionTokens("ping @all").broadcast, true);
    assert.equal(parseMentionTokens("hey @room").broadcast, true);
    assert.equal(parseMentionTokens("@everyone").broadcast, true);
  });
});

describe("selectReplyTargetIds", () => {
  it("returns primary only when human_only and no mentions", () => {
    assert.deepEqual(
      selectReplyTargetIds({
        replyPolicy: "human_only",
        participantInstanceIds: ["alpha-id", "beta-id", "delta-id"],
        mentionSlugs: [],
        slugByInstanceId: slugs,
        primaryInstanceId: "beta-id",
      }),
      ["beta-id"],
    );
  });

  it("defaults primary to first participant when primary_instance_id is null", () => {
    assert.deepEqual(
      selectReplyTargetIds({
        replyPolicy: "human_only",
        participantInstanceIds: ["alpha-id", "beta-id"],
        mentionSlugs: [],
        slugByInstanceId: slugs,
        primaryInstanceId: null,
      }),
      ["alpha-id"],
    );
  });

  it("restricts to mentioned participants", () => {
    assert.deepEqual(
      selectReplyTargetIds({
        replyPolicy: "human_only",
        participantInstanceIds: ["alpha-id", "beta-id", "delta-id"],
        mentionSlugs: ["beta", "Delta"],
        slugByInstanceId: slugs,
      }),
      ["beta-id", "delta-id"],
    );
  });

  it("broadcasts to all participants for @all", () => {
    assert.deepEqual(
      selectReplyTargetIds({
        replyPolicy: "human_only",
        participantInstanceIds: ["alpha-id", "beta-id", "delta-id"],
        mentionSlugs: [],
        broadcast: true,
        slugByInstanceId: slugs,
        primaryInstanceId: "alpha-id",
      }),
      ["alpha-id", "beta-id", "delta-id"],
    );
  });

  it("returns nobody when policy is off or mentioned_only without mentions", () => {
    assert.deepEqual(
      selectReplyTargetIds({
        replyPolicy: "off",
        participantInstanceIds: ["alpha-id", "beta-id"],
        mentionSlugs: [],
        slugByInstanceId: slugs,
      }),
      [],
    );
    assert.deepEqual(
      selectReplyTargetIds({
        replyPolicy: "mentioned_only",
        participantInstanceIds: ["alpha-id", "beta-id"],
        mentionSlugs: [],
        slugByInstanceId: slugs,
        primaryInstanceId: "alpha-id",
      }),
      [],
    );
  });

  it("excludes paused participants even when mentioned or primary", () => {
    assert.deepEqual(
      selectReplyTargetIds({
        replyPolicy: "human_only",
        participantInstanceIds: ["alpha-id", "beta-id"],
        mentionSlugs: [],
        slugByInstanceId: slugs,
        primaryInstanceId: "beta-id",
        pausedInstanceIds: ["beta-id"],
      }),
      ["alpha-id"],
    );
    assert.deepEqual(
      selectReplyTargetIds({
        replyPolicy: "human_only",
        participantInstanceIds: ["alpha-id", "beta-id"],
        mentionSlugs: ["beta"],
        slugByInstanceId: slugs,
        pausedInstanceIds: ["beta-id"],
      }),
      [],
    );
  });

  it("ignores mentions of agents who are not in the room", () => {
    assert.deepEqual(
      selectReplyTargetIds({
        replyPolicy: "human_only",
        participantInstanceIds: ["alpha-id"],
        mentionSlugs: ["beta"],
        slugByInstanceId: slugs,
      }),
      [],
    );
  });
});

describe("applyAutoTurnBudget", () => {
  it("prefers online agents when truncating", () => {
    const online = new Map([
      ["alpha-id", true],
      ["beta-id", false],
      ["delta-id", true],
      ["gamma-id", true],
    ]);
    const result = applyAutoTurnBudget({
      targetIds: ["alpha-id", "beta-id", "delta-id", "gamma-id"],
      remainingTurns: 2,
      onlineByInstanceId: online,
    });
    assert.equal(result.generate.length, 2);
    assert.ok(!result.generate.includes("beta-id"));
    assert.equal(result.ignore.length, 2);
  });

  it("clamps max auto turns", () => {
    assert.equal(clampMaxAgentAutoTurns(0), 1);
    assert.equal(clampMaxAgentAutoTurns(99), 20);
    assert.equal(clampMaxAgentAutoTurns(5), 5);
  });

  it("does not truncate a human @room hop", () => {
    const result = applyAutoTurnBudget({
      targetIds: ["alpha-id", "beta-id", "delta-id", "gamma-id", "room-id", "new-id"],
      remainingTurns: 5,
      skipBudget: true,
    });
    assert.equal(result.generate.length, 6);
    assert.equal(result.ignore.length, 0);
  });
});

describe("toHermesHistoryForAgent", () => {
  it("relabels peer assistant turns so the current agent does not claim them", () => {
    const messages = toHermesHistoryForAgent(
      [
        { role: "user", content: "hey, who is up?" },
        { role: "assistant", content: "Just me.", authorSlug: "alpha" },
        { role: "assistant", content: "Beta here.", authorSlug: "beta" },
      ],
      "beta",
    );
    assert.deepEqual(messages, [
      { role: "user", content: "hey, who is up?" },
      { role: "user", content: "@alpha: Just me." },
      { role: "assistant", content: "Beta here." },
    ]);
  });
});
