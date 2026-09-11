import { useState } from "react";
import {
  AGENT_INSTALL_PROMPT,
  FLEET_MANAGER_CONNECT_DOC,
  FLEET_MANAGER_SKILLS_TREE,
  KITS_SKILLS_TREE,
  copyText,
  downloadFleetSkillMarkdown,
} from "../../lib/connectAgentSkills";

type Props = {
  /** Instance slug for deep-link hints */
  instanceSlug?: string;
  /** When true, show link to instance tokens if slug missing */
  compact?: boolean;
};

/**
 * Explains how to connect OpenClaw/Hermes: env key + GitHub skill sync (preferred) or download.
 */
export function ConnectAgentPanel({ instanceSlug, compact }: Props) {
  const [copied, setCopied] = useState<"env" | "prompt" | null>(null);
  const [dlError, setDlError] = useState("");
  const [downloading, setDownloading] = useState(false);

  const envExample = [
    "OC_CONTROLLER_BASE_URL=http://127.0.0.1:3800",
    "OC_CONTROLLER_API_KEY=oc_inst_…   # from API tokens — keep secret",
  ].join("\n");

  async function onCopy(kind: "env" | "prompt", text: string) {
    const ok = await copyText(text);
    if (ok) {
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2000);
    }
  }

  async function onDownload() {
    setDlError("");
    setDownloading(true);
    try {
      await downloadFleetSkillMarkdown();
    } catch (e) {
      setDlError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="card connect-agent-panel">
      <h3 style={{ marginTop: 0 }}>Connect agent</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Best path: put the generated instance key in the agent’s <strong>private env</strong>, sync the
        fleet skill from <strong>GitHub</strong> (stays in sync), then tell the agent to register tools
        from <code>/api/v1/tools/schema</code>. Portal chat still needs the instance{" "}
        <strong>gateway</strong> token (Configuration tab).
      </p>

      <ol className="connect-agent-steps">
        <li>
          Generate an <strong>API token</strong>
          {instanceSlug ? (
            <>
              {" "}
              on this instance (<code>{instanceSlug}</code>)
            </>
          ) : (
            <> on the agent’s <strong>Instance → API tokens</strong></>
          )}
          . Set on the agent host:
          <pre className="code connect-agent-pre">{envExample}</pre>
          <button type="button" className="secondary" onClick={() => void onCopy("env", envExample)}>
            {copied === "env" ? "Copied" : "Copy env template"}
          </button>
        </li>
        <li>
          <strong>Preferred:</strong> sync skill from GitHub →{" "}
          <a href={FLEET_MANAGER_SKILLS_TREE} target="_blank" rel="noreferrer">
            skills/
          </a>
          , copy <code>oc-controller</code> into the workspace <code>skills/</code>.
          <div className="connect-agent-actions">
            <a className="button-link" href={FLEET_MANAGER_SKILLS_TREE} target="_blank" rel="noreferrer">
              Open GitHub skills
            </a>
            <button type="button" className="secondary" disabled={downloading} onClick={() => void onDownload()}>
              {downloading ? "Downloading…" : "Download SKILL.md"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void onCopy("prompt", AGENT_INSTALL_PROMPT)}
            >
              {copied === "prompt" ? "Copied" : "Copy “tell agent” prompt"}
            </button>
          </div>
          {dlError && <p className="badge bad">{dlError}</p>}
        </li>
        {!compact && (
          <li>
            Optional 3D companion skills (<code>character_*</code>, <code>scene_*</code>, …):{" "}
            <a href={KITS_SKILLS_TREE} target="_blank" rel="noreferrer">
              nexus-collaboration-vr/skills
            </a>
            . Only useful when chatting in a host that registers those tools (Workbench 3D).
          </li>
        )}
      </ol>

      <p className="muted" style={{ marginBottom: 0 }}>
        Full guide:{" "}
        <a href={FLEET_MANAGER_CONNECT_DOC} target="_blank" rel="noreferrer">
          CONNECT-AGENT.md
        </a>
        {!compact && (
          <>
            {" "}
            · local doc also in this repo’s <code>CONNECT-AGENT.md</code>
          </>
        )}
      </p>
    </div>
  );
}
