import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { AgentProfile, DbInstance } from "../types";
import { PageHeader } from "../components/common/PageHeader";
import { Modal } from "../components/common/Modal";
import { InstanceRuntimeFields } from "../components/instances/InstanceRuntimeFields";
import { useViewMode } from "../stores/viewMode";
import { classifyBotRuntime, RUNTIME_LABELS } from "../lib/botRuntime";
import { emptyRuntimeForm, instanceWriteBody, type RuntimeFormValue } from "../lib/instanceRuntimeForm";

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [instances, setInstances] = useState<DbInstance[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [filterInst, setFilterInst] = useState("all");
  const [bindMode, setBindMode] = useState<"existing" | "new">("existing");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const { mode } = useViewMode();
  const [form, setForm] = useState({
    instance_slug: "",
    new_slug: "",
    agent_id: "main",
    display_name: "",
    role_description: "",
    is_public: true,
  });
  const [runtimeForm, setRuntimeForm] = useState<RuntimeFormValue>(emptyRuntimeForm);

  const load = () =>
    Promise.all([
      api<{ agents: AgentProfile[] }>("/agents"),
      api<{ instances: DbInstance[] }>("/instances"),
    ]).then(([a, i]) => {
      setAgents(a.agents);
      setInstances(i.instances);
    });

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const filtered = agents.filter((a) => {
    if (mode === "tenant" && !a.isPublic) return false;
    if (filterInst !== "all" && a.instance_slug !== filterInst) return false;
    return true;
  });

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      let instanceSlug = form.instance_slug;
      if (bindMode === "new") {
        instanceSlug = form.new_slug.trim();
        if (!instanceSlug) throw new Error("Instance slug required");
        await api("/instances", {
          method: "POST",
          body: JSON.stringify({
            slug: instanceSlug,
            ...instanceWriteBody({
              ...runtimeForm,
              displayName: runtimeForm.displayName || form.display_name || instanceSlug,
            }),
          }),
        });
      }
      await api("/agents", {
        method: "POST",
        body: JSON.stringify({
          instance_slug: instanceSlug,
          agent_id: form.agent_id,
          display_name: form.display_name || form.agent_id,
          role_description: form.role_description || undefined,
          is_public: form.is_public,
        }),
      });
      setCreateOpen(false);
      setForm({
        instance_slug: "",
        new_slug: "",
        agent_id: "main",
        display_name: "",
        role_description: "",
        is_public: true,
      });
      setRuntimeForm(emptyRuntimeForm());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Agents"
        subtitle="Profiles for OpenClaw, Hermes, and OpenAI-like agent instances"
        actions={
          <button type="button" onClick={() => setCreateOpen(true)}>
            Add agent
          </button>
        }
      />

      <div className="toolbar">
        <select value={filterInst} onChange={(e) => setFilterInst(e.target.value)}>
          <option value="all">All instances</option>
          {instances.map((i) => (
            <option key={i.id} value={i.slug}>
              {i.slug}
            </option>
          ))}
        </select>
      </div>

      <div className="grid">
        {filtered.map((a) => (
          <Link key={a.id} to={`/agents/${a.id}`} className="card" style={{ color: "inherit" }}>
            <strong>{a.displayName || a.agentId}</strong>
            <div className="muted">
              {a.instance_slug} / {a.agentId}
            </div>
            <span className="badge">{RUNTIME_LABELS[classifyBotRuntime(a.runtime)]}</span>{" "}
            {a.roleDescription && <p style={{ fontSize: "0.9rem" }}>{a.roleDescription}</p>}
            <span className={`badge ${a.isPublic ? "ok" : ""}`}>{a.isPublic ? "public" : "internal"}</span>
          </Link>
        ))}
      </div>

      <Modal
        open={createOpen}
        title="Add agent"
        onClose={() => setCreateOpen(false)}
        wide={bindMode === "new"}
      >
        <form onSubmit={(e) => void onCreate(e)} className="form-grid">
          {error ? <p className="badge bad full">{error}</p> : null}
          <label className="full">
            Bind to
            <select
              value={bindMode}
              onChange={(e) => setBindMode(e.target.value === "new" ? "new" : "existing")}
            >
              <option value="existing">Existing instance</option>
              <option value="new">New instance (OpenClaw / Hermes / OpenAI-like)</option>
            </select>
          </label>
          {bindMode === "existing" ? (
            <label>
              Instance *
              <select
                required
                value={form.instance_slug}
                onChange={(e) => setForm({ ...form, instance_slug: e.target.value })}
              >
                <option value="">Select…</option>
                {instances.map((i) => (
                  <option key={i.id} value={i.slug}>
                    {i.slug} · {RUNTIME_LABELS[classifyBotRuntime(i.identity?.runtime)]}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              Instance slug *
              <input
                required
                pattern="[a-z0-9][a-z0-9-]*"
                value={form.new_slug}
                onChange={(e) => setForm({ ...form, new_slug: e.target.value })}
                placeholder="alpha"
              />
            </label>
          )}
          <label>
            Agent ID *
            <input
              required
              value={form.agent_id}
              onChange={(e) => setForm({ ...form, agent_id: e.target.value })}
              placeholder="main"
            />
          </label>
          <label>
            Display name
            <input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          </label>
          <label>
            Role
            <input
              value={form.role_description}
              onChange={(e) => setForm({ ...form, role_description: e.target.value })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.is_public}
              onChange={(e) => setForm({ ...form, is_public: e.target.checked })}
            />{" "}
            Public profile
          </label>
          {bindMode === "new" ? (
            <div className="full">
              <InstanceRuntimeFields
                value={{
                  ...runtimeForm,
                  displayName: runtimeForm.displayName || form.display_name,
                }}
                onChange={setRuntimeForm}
              />
            </div>
          ) : null}
          <button type="submit" disabled={saving}>
            {saving ? "Creating…" : "Create"}
          </button>
        </form>
      </Modal>
    </>
  );
}
