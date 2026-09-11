/** Public URLs and helpers for Connect Agent / skill install. */

export const FLEET_MANAGER_REPO =
  "https://github.com/AR-General/BAL-Agent-Fleet-Manager";
export const FLEET_MANAGER_SKILLS_TREE = `${FLEET_MANAGER_REPO}/tree/main/skills`;
export const FLEET_MANAGER_CONNECT_DOC = `${FLEET_MANAGER_REPO}/blob/main/CONNECT-AGENT.md`;
export const FLEET_MANAGER_SKILL_RAW =
  `${FLEET_MANAGER_REPO}/raw/main/skills/oc-controller/SKILL.md`;

export const KITS_REPO = "https://github.com/assetsnexus/nexus-collaboration-vr";
export const KITS_SKILLS_TREE = `${KITS_REPO}/tree/main/skills`;
export const KITS_AGENT_SKILLS_DOC = `${KITS_REPO}/blob/main/docs/agent-skills.md`;

/** Served by Vite from repo `skills/` (dev + build copy). */
export const LOCAL_FLEET_SKILL_PATH = "/skills/oc-controller/SKILL.md";

export const AGENT_INSTALL_PROMPT = [
  "Install or sync the oc-controller fleet skill from GitHub:",
  "`AR-General/BAL-Agent-Fleet-Manager` → copy `skills/oc-controller` into this workspace `skills/`.",
  "Prefer git sync so the skill stays current.",
  "Then call GET {OC_CONTROLLER_BASE_URL}/api/v1/tools/schema with Authorization: Bearer $OC_CONTROLLER_API_KEY",
  "and register those tools. Do not invent tool names.",
].join(" ");

export async function downloadFleetSkillMarkdown(filename = "oc-controller-SKILL.md"): Promise<void> {
  const tried = [LOCAL_FLEET_SKILL_PATH, FLEET_MANAGER_SKILL_RAW];
  let lastErr: unknown;
  for (const url of tried) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} → ${res.status}`);
      const text = await res.text();
      const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Skill download failed");
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
