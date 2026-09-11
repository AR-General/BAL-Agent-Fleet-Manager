import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_INSTALL_PROMPT,
  FLEET_MANAGER_CONNECT_DOC,
  FLEET_MANAGER_REPO,
  FLEET_MANAGER_SKILLS_TREE,
  KITS_SKILLS_TREE,
  LOCAL_FLEET_SKILL_PATH,
} from "./connectAgentSkills.ts";

describe("connectAgentSkills", () => {
  it("points at public GitHub trees", () => {
    assert.match(FLEET_MANAGER_REPO, /BAL-Agent-Fleet-Manager/);
    assert.match(FLEET_MANAGER_SKILLS_TREE, /\/skills$/);
    assert.match(FLEET_MANAGER_CONNECT_DOC, /CONNECT-AGENT/);
    assert.match(KITS_SKILLS_TREE, /nexus-collaboration-vr/);
    assert.equal(LOCAL_FLEET_SKILL_PATH, "/skills/oc-controller/SKILL.md");
  });

  it("install prompt mentions schema + GitHub", () => {
    assert.match(AGENT_INSTALL_PROMPT, /tools\/schema/);
    assert.match(AGENT_INSTALL_PROMPT, /BAL-Agent-Fleet-Manager/);
    assert.match(AGENT_INSTALL_PROMPT, /OC_CONTROLLER_API_KEY/);
  });
});
